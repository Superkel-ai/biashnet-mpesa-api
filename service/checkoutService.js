const {
    db,
    FieldValue,
} = require("../config/firebase");

const {
    COLLECTIONS,
} = require("../config/collections");

const {
    ORDER_STATUS,
    PAYMENT_STATUS,
    SELLER_PAYMENT_STATUS,
    PAYOUT_STATUS,
} = require("../config/paymentConstants");

const {
    generateOrderId,
} = require("../utils/codeGenerator");

const {
    calculateCommission,
} = require("./commissionService");


/*
=========================================================
BIASHNET CHECKOUT SERVICE
=========================================================

RESPONSIBILITY

Converts the buyer's cart into a server-controlled
marketplace order.

FLOW

Android / Web
      ↓
checkoutController
      ↓
checkoutService
      ↓
Validate buyer
      ↓
Validate cart
      ↓
Read authoritative products
      ↓
Verify product status
      ↓
Verify seller
      ↓
Verify price
      ↓
Verify stock
      ↓
Calculate commission
      ↓
Group sellers
      ↓
Create PENDING_PAYMENT order
      ↓
paymentInitiationService
      ↓
M-PESA STK Push
      ↓
paymentCallbackService
      ↓
Payment confirmed
      ↓
Stock deduction / settlement

IMPORTANT

This service NEVER trusts:

- frontend price
- frontend sellerId
- frontend commission
- frontend totals
- frontend buyerId

buyerId must come from Firebase authentication.

Checkout does NOT:

- mark payment as successful
- mark order as completed
- deduct stock
- release seller funds
- calculate M-PESA results

Those belong to the payment/settlement flow.
=========================================================
*/


/*
=========================================================
MONEY HELPER
=========================================================
*/

function money(value) {

    const number = Number(value);

    if (!Number.isFinite(number)) {

        throw new Error(
            "Invalid monetary value."
        );

    }

    return Number(
        number.toFixed(2)
    );

}


/*
=========================================================
NORMALIZE KENYAN PHONE NUMBER
=========================================================

Supports:

0712345678
0112345678
254712345678
+254712345678
=========================================================
*/

function normalizeKenyanPhone(phone) {

    if (!phone) {

        return null;

    }

    let value =
        String(phone)
            .trim()
            .replace(/\s+/g, "")
            .replace(/-/g, "");


    if (value.startsWith("+")) {

        value =
            value.substring(1);

    }


    if (
        value.startsWith("07") ||
        value.startsWith("01")
    ) {

        value =
            `254${value.substring(1)}`;

    }


    if (
        !/^254(7|1)\d{8}$/.test(value)
    ) {

        throw new Error(
            "Invalid Kenyan phone number."
        );

    }


    return value;

}


/*
=========================================================
NORMALIZE DELIVERY ADDRESS
=========================================================
*/

function normalizeDeliveryAddress(
    deliveryAddress
) {

    if (
        deliveryAddress === null ||
        deliveryAddress === undefined
    ) {

        return null;

    }


    if (
        typeof deliveryAddress !== "object" ||
        Array.isArray(deliveryAddress)
    ) {

        throw new Error(
            "Delivery address must be an object."
        );

    }


    const normalized = {

        name:
            deliveryAddress.name
                ? String(
                    deliveryAddress.name
                ).trim()
                : null,

        phone:
            deliveryAddress.phone
                ? String(
                    deliveryAddress.phone
                ).trim()
                : null,

        location:
            deliveryAddress.location
                ? String(
                    deliveryAddress.location
                ).trim()
                : null,

        landmark:
            deliveryAddress.landmark
                ? String(
                    deliveryAddress.landmark
                ).trim()
                : null,

        notes:
            deliveryAddress.notes
                ? String(
                    deliveryAddress.notes
                ).trim()
                : null,

    };


    if (!normalized.location) {

        throw new Error(
            "Delivery location is required."
        );

    }


    return normalized;

}

/*
=========================================================
PRODUCT AVAILABILITY VALIDATION
=========================================================

BIASHNET PRODUCT SCHEMA

Current marketplace products use:

    status: "approved"
    isActive: true

Newer products may use:

    status: "ACTIVE"
    isActive: true

CHECKOUT REQUIREMENTS

A product is available for purchase when:

    1. isActive is true
    AND
    2. status is approved/active

Accepted statuses:

    approved
    active
    APPROVED
    ACTIVE

Rejected statuses include:

    rejected
    disabled
    inactive
    deleted
    draft

A product with:

    isActive === false

is ALWAYS unavailable.

=========================================================
*/

function isProductAvailable(product) {

    /*
    =====================================================
    BASIC VALIDATION
    =====================================================
    */

    if (!product) {

        return false;

    }


    /*
    =====================================================
    isActive
    =====================================================

    Your existing products have:

        isActive: true

    This must be true for a product to be purchasable.
    =====================================================
    */

    if (
        product.isActive !== true
    ) {

        return false;

    }


    /*
    =====================================================
    STATUS
    =====================================================
    */

    const status =
        String(
            product.status || ""
        )
            .trim()
            .toLowerCase();


    /*
    =====================================================
    ACCEPTED MARKETPLACE STATUSES
    =====================================================
    */

    const allowedStatuses = [

        "approved",

        "active",

    ];


    /*
    =====================================================
    FINAL STATUS CHECK
    =====================================================
    */

    return allowedStatuses.includes(
        status
    );

}

/*
=========================================================
GET SELLER ID
=========================================================

Current BIASHNET listings use:

userId

Newer marketplace documents may use:

sellerId

Prefer sellerId, then fall back to userId.
=========================================================
*/

function getSellerId(product) {

    const sellerId =
        product.sellerId ||
        product.userId ||
        null;


    if (!sellerId) {

        return null;

    }


    return String(
        sellerId
    ).trim();

}


/*
=========================================================
GET PRODUCT IMAGE
=========================================================

Supports current BIASHNET structure:

images: [
    {
        full,
        thumb,
        small,
        original
    }
]

Also supports:

image
thumbnail
=========================================================
*/

function getProductImage(product) {

    if (
        product.image
    ) {

        return product.image;

    }


    if (
        product.thumbnail
    ) {

        return product.thumbnail;

    }


    if (
        Array.isArray(product.images) &&
        product.images.length > 0
    ) {

        const firstImage =
            product.images[0];


        if (
            firstImage &&
            typeof firstImage === "object"
        ) {

            return (
                firstImage.full ||
                firstImage.thumb ||
                firstImage.small ||
                firstImage.original ||
                null
            );

        }


        if (
            typeof firstImage === "string"
        ) {

            return firstImage;

        }

    }


    return null;

}


/*
=========================================================
GET PRODUCT TITLE
=========================================================
*/

function getProductTitle(product, listingId) {

    return (
        product.title ||
        product.name ||
        listingId
    );

}


/*
=========================================================
GET PRODUCT PRICE
=========================================================

IMPORTANT:

Checkout NEVER trusts the frontend price.

Current BIASHNET product:

price: 799

That is authoritative.

If a future pricing service introduces another
authoritative price, that logic should be placed here.
=========================================================
*/

function getProductPrice(product) {

    const price =
        Number(
            product.price
        );


    if (
        !Number.isFinite(price) ||
        price <= 0
    ) {

        throw new Error(
            "Product has an invalid price."
        );

    }


    return money(
        price
    );

}


/*
=========================================================
GET PRODUCT STOCK
=========================================================
*/

function getProductStock(product) {

    const stock =
        Number(
            product.stock
        );


    if (
        !Number.isInteger(stock) ||
        stock < 0
    ) {

        throw new Error(
            "Product has invalid stock."
        );

    }


    return stock;

}


/*
=========================================================
CREATE CHECKOUT
=========================================================
*/

async function createCheckout({

    buyerId,

    items,

    buyerPhone,

    deliveryAddress = null,

    idempotencyKey = null,

}) {

    /*
    =====================================================
    BUYER VALIDATION
    =====================================================
    */

    if (!buyerId) {

        throw new Error(
            "Buyer ID is required."
        );

    }


    /*
    =====================================================
    CART VALIDATION
    =====================================================
    */

    if (
        !Array.isArray(items) ||
        items.length === 0
    ) {

        throw new Error(
            "Checkout must contain at least one item."
        );

    }


    if (items.length > 50) {

        throw new Error(
            "Too many items in one checkout."
        );

    }


    /*
    =====================================================
    PHONE
    =====================================================
    */

    const normalizedPhone =
        normalizeKenyanPhone(
            buyerPhone
        );


    /*
    =====================================================
    DELIVERY
    =====================================================
    */

    const normalizedAddress =
        normalizeDeliveryAddress(
            deliveryAddress
        );


    /*
    =====================================================
    IDEMPOTENCY KEY
    =====================================================
    */

    let cleanIdempotencyKey = null;

    let idempotencyRef = null;


    if (idempotencyKey) {

        cleanIdempotencyKey =
            String(
                idempotencyKey
            ).trim();


        if (
            cleanIdempotencyKey.length < 8 ||
            cleanIdempotencyKey.length > 128
        ) {

            throw new Error(
                "Invalid idempotency key."
            );

        }


        const safeKey =
            cryptoSafeId(
                cleanIdempotencyKey
            );


        idempotencyRef =
            db
                .collection(
                    COLLECTIONS.PAYMENT_IDEMPOTENCY
                )
                .doc(
                    `${buyerId}_${safeKey}`
                );


        /*
        -------------------------------------------------
        CHECK EXISTING CHECKOUT
        -------------------------------------------------
        */

        const existing =
            await idempotencyRef.get();


        if (existing.exists) {

            const existingData =
                existing.data();


            if (
                existingData &&
                existingData.orderId
            ) {

                const existingOrder =
                    await db
                        .collection(
                            COLLECTIONS.ORDERS
                        )
                        .doc(
                            existingData.orderId
                        )
                        .get();


                if (existingOrder.exists) {

                    return {

                        success:
                            true,

                        alreadyCreated:
                            true,

                        ...existingOrder.data(),

                    };

                }

            }

        }

    }


    /*
    =====================================================
    DUPLICATE LISTING CHECK
    =====================================================
    */

    const listingIds =
        new Set();


    for (
        const item of items
    ) {

        if (!item) {

            throw new Error(
                "Invalid checkout item."
            );

        }


        const listingId =
            String(
                item.listingId || ""
            ).trim();


        if (!listingId) {

            throw new Error(
                "Each checkout item must contain a listingId."
            );

        }


        if (
            listingIds.has(
                listingId
            )
        ) {

            throw new Error(
                `Product ${listingId} appears more than once in the checkout.`
            );

        }


        listingIds.add(
            listingId
        );

    }


    /*
    =====================================================
    PREPARE TOTALS
    =====================================================
    */

    let subtotal = 0;

    let totalCommission = 0;

    let totalSellerGross = 0;


    const orderItems = [];


    /*
    =====================================================
    SELLER MAP
    =====================================================
    */

    const sellerMap =
        new Map();


    /*
    =====================================================
    PROCESS EACH CART ITEM
    =====================================================
    */

    for (
        const requestedItem of items
    ) {

        const listingId =
            String(
                requestedItem.listingId
            ).trim();


        const requestedQuantity =
            Number(
                requestedItem.quantity
            );


        /*
        -------------------------------------------------
        QUANTITY
        -------------------------------------------------
        */

        if (
            !Number.isInteger(
                requestedQuantity
            ) ||
            requestedQuantity <= 0
        ) {

            throw new Error(
                `Invalid quantity for product ${listingId}.`
            );

        }


        /*
        -------------------------------------------------
        GET AUTHORITATIVE PRODUCT
        -------------------------------------------------
        */

        const productRef =
            db
                .collection(
                    COLLECTIONS.PRODUCTS
                )
                .doc(
                    listingId
                );


        const productSnapshot =
            await productRef.get();


        if (
            !productSnapshot.exists
        ) {

            throw new Error(
                `Product ${listingId} no longer exists.`
            );

        }


        const product =
            productSnapshot.data();


        /*
        -------------------------------------------------
        PRODUCT AVAILABILITY
        -------------------------------------------------
        */

        if (
            !isProductAvailable(
                product
            )
        ) {

            throw new Error(
                `Product ${getProductTitle(product, listingId)} is not available.`
            );

        }


        /*
        -------------------------------------------------
        SELLER
        -------------------------------------------------
        */

        const sellerId =
            getSellerId(
                product
            );


        if (!sellerId) {

            throw new Error(
                `Product ${listingId} has no seller.`
            );

        }


        /*
        -------------------------------------------------
        PREVENT BUYING OWN PRODUCT
        -------------------------------------------------
        */

        if (
            sellerId === buyerId
        ) {

            throw new Error(
                "You cannot purchase your own product."
            );

        }


        /*
        -------------------------------------------------
        PRICE
        -------------------------------------------------
        */

        const unitPrice =
            getProductPrice(
                product
            );


        /*
        -------------------------------------------------
        STOCK
        -------------------------------------------------
        */

        const currentStock =
            getProductStock(
                product
            );


        if (
            currentStock <
            requestedQuantity
        ) {

            throw new Error(
                `Insufficient stock for ${getProductTitle(product, listingId)}. Available: ${currentStock}.`
            );

        }


        /*
        -------------------------------------------------
        ITEM TOTAL
        -------------------------------------------------
        */

        const itemTotal =
            money(
                unitPrice *
                requestedQuantity
            );


        /*
        -------------------------------------------------
        COMMISSION
        -------------------------------------------------
        */

        const commission =
            await calculateCommission({

                amount:
                    itemTotal,

                category:
                    product.category ||
                    "general",

            });


        const commissionAmount =
            money(
                commission.commissionAmount
            );


        const sellerGross =
            money(
                itemTotal
            );


        const sellerNet =
            money(
                sellerGross -
                commissionAmount
            );


        /*
        -------------------------------------------------
        COMMISSION SAFETY
        -------------------------------------------------
        */

        if (
            commissionAmount < 0
        ) {

            throw new Error(
                `Invalid commission for product ${listingId}.`
            );

        }


        if (
            sellerNet < 0
        ) {

            throw new Error(
                `Invalid commission calculation for product ${listingId}.`
            );

        }


        /*
        -------------------------------------------------
        ORDER ITEM
        -------------------------------------------------
        */

        orderItems.push({

            listingId,

            sellerId,

            title:
                getProductTitle(
                    product,
                    listingId
                ),

            image:
                getProductImage(
                    product
                ),

            category:
                commission.category ||
                product.category ||
                "general",

            quantity:
                requestedQuantity,

            unitPrice,

            itemTotal,

            commissionRate:
                Number(
                    commission.commissionRate ||
                    0
                ),

            commissionAmount,

            sellerGross,

            sellerNet,

        });


        /*
        -------------------------------------------------
        TOTALS
        -------------------------------------------------
        */

        subtotal =
            money(
                subtotal +
                itemTotal
            );


        totalCommission =
            money(
                totalCommission +
                commissionAmount
            );


        totalSellerGross =
            money(
                totalSellerGross +
                sellerGross
            );


        /*
        -------------------------------------------------
        SELLER BREAKDOWN
        -------------------------------------------------
        */

        if (
            !sellerMap.has(
                sellerId
            )
        ) {

            sellerMap.set(
                sellerId,
                {

                    sellerId,

                    sellerName:
                        product.sellerName ||
                        null,

                    sellerPhone:
                        product.sellerPhone ||
                        null,

                    grossAmount:
                        0,

                    commissionAmount:
                        0,

                    sellerNet:
                        0,

                    sellerPaymentStatus:
                        SELLER_PAYMENT_STATUS.NOT_RELEASED,

                    payoutStatus:
                        PAYOUT_STATUS.NOT_RELEASED,

                }
            );

        }


        const seller =
            sellerMap.get(
                sellerId
            );


        seller.grossAmount =
            money(
                seller.grossAmount +
                sellerGross
            );


        seller.commissionAmount =
            money(
                seller.commissionAmount +
                commissionAmount
            );


        seller.sellerNet =
            money(
                seller.sellerNet +
                sellerNet
            );

    }

/*
=========================================================
DELIVERY FEE
=========================================================

Currently KES 0.

The delivery fee is part of the buyer's total but is
NOT seller revenue and is NOT commissionable.

Later this can be replaced by a dedicated delivery
pricing service.
=========================================================
*/

const deliveryFee = 0;


/*
=========================================================
BUYER TOTAL
=========================================================
*/

const buyerTotal =
    money(
        subtotal +
        deliveryFee
    );


/*
=========================================================
FINAL SELLER NET
=========================================================
*/

const sellerNet =
    money(
        totalSellerGross -
        totalCommission
    );


/*
=========================================================
COMMISSION SAFETY
=========================================================

Commission must never exceed the seller's gross amount.
=========================================================
*/

if (
    totalCommission < 0 ||
    totalCommission > totalSellerGross
) {

    throw new Error(
        "Invalid checkout commission calculation."
    );

}


/*
=========================================================
FINANCIAL CONSISTENCY
=========================================================

The marketplace financial model is:

buyerTotal
    =
sellerNet
    +
BIASHNET commission
    +
deliveryFee

And:

sellerNet
    =
sellerGross
    -
commission
=========================================================
*/

const financialTotal =
    money(
        sellerNet +
        totalCommission +
        deliveryFee
    );


if (
    financialTotal !==
    buyerTotal
) {

    throw new Error(
        `Checkout financial calculation mismatch. Buyer total: ${buyerTotal}, Financial total: ${financialTotal}.`
    );

}


/*
=========================================================
SELLER BREAKDOWN
=========================================================
*/

const sellerBreakdown =
    Array.from(
        sellerMap.values()
    );


/*
=========================================================
SELLER BREAKDOWN CONSISTENCY
=========================================================

The sum of individual seller net amounts must equal
the overall seller net.
=========================================================
*/

const sellerBreakdownNet =
    money(
        sellerBreakdown.reduce(
            (
                total,
                seller
            ) =>
                total +
                Number(
                    seller.sellerNet || 0
                ),
            0
        )
    );


if (
    sellerBreakdownNet !==
    sellerNet
) {

    throw new Error(
        `Seller settlement calculation mismatch. Expected: ${sellerNet}, calculated: ${sellerBreakdownNet}.`
    );

}


/*
=========================================================
SELLER IDs
=========================================================
*/

const sellerIds =
    sellerBreakdown.map(
        seller =>
            seller.sellerId
    );
    
    /*
    =====================================================
    ORDER ID
    =====================================================
    */

    const orderId =
        generateOrderId();


    /*
    =====================================================
    ORDER REFERENCE
    =====================================================
    */

    const orderRef =
        db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(
                orderId
            );


    /*
    =====================================================
    ORDER DATA
    =====================================================
    */

    const orderData = {

        /*
        -----------------------------------------------
        IDENTIFICATION
        -----------------------------------------------
        */

        orderId,

        buyerId,

        currency:
            "KES",


        /*
        -----------------------------------------------
        ITEMS
        -----------------------------------------------
        */

        items:
            orderItems,


        /*
        -----------------------------------------------
        SELLERS
        -----------------------------------------------
        */

        sellerBreakdown,

        sellerIds,


        /*
        -----------------------------------------------
        FINANCIALS
        -----------------------------------------------
        */

        subtotal,

        deliveryFee,

        buyerTotal,

        commissionAmount:
            totalCommission,

        sellerGross:
            totalSellerGross,

        sellerNet,


        /*
        -----------------------------------------------
        PAYMENT
        -----------------------------------------------
        */

        paymentId:
            null,

        paymentMethod:
            null,

        paymentStatus:
            PAYMENT_STATUS.PENDING,

        providerTransactionId:
            null,

        checkoutRequestId:
            null,

        merchantRequestId:
            null,


        /*
        -----------------------------------------------
        SELLER FUNDS
        -----------------------------------------------
        */

        fundsReceived:
            false,

        fundsHeld:
            false,

        sellerPaymentStatus:
            SELLER_PAYMENT_STATUS.NOT_RELEASED,

        payoutStatus:
            PAYOUT_STATUS.NOT_RELEASED,


        /*
        -----------------------------------------------
        ORDER STATUS
        -----------------------------------------------
        */

        status:
            ORDER_STATUS.PENDING_PAYMENT,


        /*
        -----------------------------------------------
        BUYER
        -----------------------------------------------
        */

        buyerPhone:
            normalizedPhone,

        deliveryAddress:
            normalizedAddress,


        /*
        -----------------------------------------------
        COMPLETION CODE
        -----------------------------------------------
        */

        orderCompletionCodeHash:
            null,

        orderCompletionCodeStatus:
            "NOT_GENERATED",

        orderCompletionCodeCreatedAt:
            null,


        /*
        -----------------------------------------------
        COMPLETION
        -----------------------------------------------
        */

        orderCompletedAt:
            null,

        completedBy:
            null,


        /*
        -----------------------------------------------
        STOCK
        -----------------------------------------------
        */

        stockStatus:
            "NOT_DEDUCTED",


        /*
        -----------------------------------------------
        IDEMPOTENCY
        -----------------------------------------------
        */

        checkoutIdempotencyKey:
            cleanIdempotencyKey,


        /*
        -----------------------------------------------
        TIMESTAMPS
        -----------------------------------------------
        */

        createdAt:
            FieldValue.serverTimestamp(),

        updatedAt:
            FieldValue.serverTimestamp(),

    };


    /*
    =====================================================
    ATOMIC ORDER CREATION
    =====================================================

    IMPORTANT

    All transaction reads happen BEFORE writes.

    Firestore requires transaction reads to happen before
    transaction writes.
    =====================================================
    */

    await db.runTransaction(
        async (transaction) => {

            /*
            ---------------------------------------------
            READ ORDER
            ---------------------------------------------
            */

            const existingOrder =
                await transaction.get(
                    orderRef
                );


            /*
            ---------------------------------------------
            READ IDEMPOTENCY
            ---------------------------------------------
            */

            let existingKey =
                null;


            if (
                idempotencyRef
            ) {

                existingKey =
                    await transaction.get(
                        idempotencyRef
                    );

            }


            /*
            ---------------------------------------------
            ORDER ID COLLISION
            ---------------------------------------------
            */

            if (
                existingOrder.exists
            ) {

                throw new Error(
                    "Order ID collision. Please retry."
                );

            }


            /*
            ---------------------------------------------
            IDEMPOTENCY COLLISION
            ---------------------------------------------
            */

            if (
                existingKey &&
                existingKey.exists
            ) {

                const existingData =
                    existingKey.data();


                if (
                    existingData &&
                    existingData.orderId
                ) {

                    throw new Error(
                        "Checkout already exists for this idempotency key."
                    );

                }

            }


            /*
            ---------------------------------------------
            WRITE IDEMPOTENCY RECORD
            ---------------------------------------------
            */

            if (
                idempotencyRef
            ) {

                transaction.set(
                    idempotencyRef,
                    {

                        buyerId,

                        orderId,

                        type:
                            "CHECKOUT",

                        createdAt:
                            FieldValue.serverTimestamp(),

                    }
                );

            }


            /*
            ---------------------------------------------
            CREATE ORDER
            ---------------------------------------------
            */

            transaction.create(
                orderRef,
                orderData
            );

        }
    );


    /*
    =====================================================
    RESPONSE
    =====================================================
    */

    return {

        success:
            true,

        alreadyCreated:
            false,

        orderId,

        status:
            ORDER_STATUS.PENDING_PAYMENT,

        paymentStatus:
            PAYMENT_STATUS.PENDING,

        currency:
            "KES",

        items:
            orderItems,

        sellerBreakdown,

        sellerIds,

        subtotal,

        deliveryFee,

        buyerTotal,

        commissionAmount:
            totalCommission,

        sellerGross:
            totalSellerGross,

        sellerNet,

        message:
            "Checkout created successfully. Proceed to payment.",

    };

}


/*
=========================================================
SAFE IDEMPOTENCY ID
=========================================================

Firestore document IDs cannot contain "/".

We hash the client key into a deterministic safe ID.

The actual idempotency protection comes from the
Firestore document + transaction.
=========================================================
*/

function cryptoSafeId(value) {

    return require("crypto")
        .createHash("sha256")
        .update(
            String(value)
        )
        .digest("hex");

}


/*
=========================================================
GET CHECKOUT
=========================================================

Returns an order only when the authenticated buyer
owns the order.
=========================================================
*/

async function getCheckout({

    orderId,

    buyerId,

}) {

    /*
    =====================================================
    VALIDATION
    =====================================================
    */

    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }


    if (!buyerId) {

        throw new Error(
            "Buyer ID is required."
        );

    }


    /*
    =====================================================
    GET ORDER
    =====================================================
    */

    const orderRef =
        db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(
                orderId
            );


    const snapshot =
        await orderRef.get();


    /*
    =====================================================
    NOT FOUND
    =====================================================
    */

    if (
        !snapshot.exists
    ) {

        return null;

    }


    const order =
        snapshot.data();


    /*
    =====================================================
    AUTHORIZATION
    =====================================================
    */

    if (
        order.buyerId !==
        buyerId
    ) {

        throw new Error(
            "You are not authorized to access this order."
        );

    }


    /*
    =====================================================
    RESPONSE
    =====================================================
    */

    return {

        id:
            snapshot.id,

        ...order,

    };

}


/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

    createCheckout,

    getCheckout,

};