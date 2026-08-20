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

FLOW:

Android
   ↓
checkoutController
   ↓
checkoutService
   ↓
Validate cart
   ↓
Read products from Firestore
   ↓
Verify prices
   ↓
Verify stock
   ↓
Calculate commission
   ↓
Group sellers
   ↓
Create marketplace order
   ↓
PENDING_PAYMENT
   ↓
paymentInitiationService
   ↓
M-PESA STK

IMPORTANT:

This service NEVER trusts:

- frontend price
- frontend sellerId
- frontend commission
- frontend totals
- frontend buyerId

buyerId must come from Firebase authentication.

The order is NOT marked paid here.

The order is NOT marked completed here.

Stock is NOT reduced here.

Payment completion is handled by:

paymentCallbackService
paymentService

Seller funds are handled by:

settlementService
=========================================================
*/


/*
=========================================================
MONEY HELPER
=========================================================
*/

function money(value) {

    const number =
        Number(value);

    if (
        !Number.isFinite(number)
    ) {

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
NORMALIZE PHONE NUMBER
=========================================================

Supports common Kenyan formats:

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


    if (
        value.startsWith("+")
    ) {

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
VALIDATE DELIVERY ADDRESS
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


    if (
        !normalized.location
    ) {

        throw new Error(
            "Delivery location is required."
        );

    }


    return normalized;

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


    if (
        items.length > 50
    ) {

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
    DUPLICATE LISTING CHECK
    =====================================================

    Prevent:

    product A quantity 1
    product A quantity 2

    inside the same checkout.
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
            listingIds.has(listingId)
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
    SELLER BREAKDOWN
    =====================================================

    Example:

    sellerA:
        gross: 10000
        commission: 1000
        net: 9000

    sellerB:
        gross: 5000
        commission: 500
        net: 4500
    =====================================================
    */

    const sellerMap =
        new Map();


    /*
    =====================================================
    PROCESS CART
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
                .doc(listingId);


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
        PRODUCT STATUS
        -------------------------------------------------
        */

        if (
            product.status &&
            product.status !== "ACTIVE"
        ) {

            throw new Error(
                `Product ${product.title || listingId} is not available.`
            );

        }


        /*
        -------------------------------------------------
        SELLER
        -------------------------------------------------
        */

        const sellerId =
            product.sellerId;


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

        NEVER use:

        requestedItem.price

        The price comes from Firestore.
        -------------------------------------------------
        */

        const unitPrice =
            Number(
                product.price
            );


        if (
            !Number.isFinite(unitPrice) ||
            unitPrice <= 0
        ) {

            throw new Error(
                `Invalid price for product ${listingId}.`
            );

        }


        /*
        -------------------------------------------------
        STOCK CHECK
        -------------------------------------------------
        */

        const currentStock =
            Number(
                product.stock || 0
            );


        if (
            !Number.isInteger(
                currentStock
            ) ||
            currentStock < 0
        ) {

            throw new Error(
                `Invalid stock for product ${listingId}.`
            );

        }


        if (
            currentStock <
            requestedQuantity
        ) {

            throw new Error(
                `Insufficient stock for ${product.title || listingId}. Available: ${currentStock}.`
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

        Commission is calculated NOW and stored as a
        snapshot on the order.

        Payment callback must NOT recalculate it.
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
        SAFETY CHECK
        -------------------------------------------------
        */

        if (
            sellerNet < 0
        ) {

            throw new Error(
                `Invalid commission calculation for product ${listingId}.`
            );

        }


        /*
        -------------------------------------------------
        ADD ORDER ITEM
        -------------------------------------------------
        */

        orderItems.push({

            listingId,

            sellerId,

            title:
                product.title ||
                product.name ||
                "",

            image:
                product.image ||
                product.thumbnail ||
                null,

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
                    commission.commissionRate || 0
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
    =====================================================
    DELIVERY FEE
    =====================================================

    Currently zero.

    Later this should come from a dedicated
    delivery/pricing service.
    =====================================================
    */

    const deliveryFee =
        0;


    /*
    =====================================================
    BUYER TOTAL
    =====================================================
    */

    const buyerTotal =
        money(
            subtotal +
            deliveryFee
        );


    /*
    =====================================================
    FINANCIAL CONSISTENCY CHECK
    =====================================================
    */

    if (
        money(
            totalCommission +
            totalSellerGross
        ) !==
        money(
            buyerTotal
        )
    ) {

        throw new Error(
            "Checkout financial calculation mismatch."
        );

    }


    /*
    =====================================================
    SELLER BREAKDOWN ARRAY
    =====================================================
    */

    const sellerBreakdown =
        Array.from(
            sellerMap.values()
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
    IDEMPOTENCY
    =====================================================

    If the frontend supplies an idempotency key,
    prevent accidental duplicate checkouts.

    We use:

    buyerId + idempotencyKey

    as the document ID.
    =====================================================
    */

    let idempotencyRef =
        null;


    if (idempotencyKey) {

        const cleanKey =
            String(
                idempotencyKey
            )
                .trim();


        if (
            cleanKey.length < 8 ||
            cleanKey.length > 128
        ) {

            throw new Error(
                "Invalid idempotency key."
            );

        }


        const safeKey =
            cryptoSafeId(
                cleanKey
            );


        idempotencyRef =
            db
                .collection(
                    COLLECTIONS.PAYMENT_IDEMPOTENCY
                )
                .doc(
                    `${buyerId}_${safeKey}`
                );


        const existing =
            await idempotencyRef.get();


        if (
            existing.exists
        ) {

            const existingData =
                existing.data();


            if (
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


                if (
                    existingOrder.exists
                ) {

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
    CREATE ORDER
    =====================================================
    */

    const orderRef =
        db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(orderId);


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


        sellerIds:
            sellerBreakdown.map(
                seller =>
                    seller.sellerId
            ),


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


        sellerNet:
            money(
                totalSellerGross -
                totalCommission
            ),


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

        Nothing is released at checkout.
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
        BUYER INFORMATION
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

        Generated ONLY after successful payment.

        Plain code is NEVER stored.
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
        ORDER COMPLETION
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

        Stock has only been checked.

        It will be reduced after confirmed payment.
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
            idempotencyKey
                ? String(
                    idempotencyKey
                ).trim()
                : null,


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
    ATOMIC CREATION
    =====================================================
    */

    await db.runTransaction(
        async (transaction) => {

            /*
            ---------------------------------------------
            CHECK ORDER ID
            ---------------------------------------------
            */

            const existingOrder =
                await transaction.get(
                    orderRef
                );


            if (
                existingOrder.exists
            ) {

                throw new Error(
                    "Order ID collision. Please retry."
                );

            }


            /*
            ---------------------------------------------
            IDEMPOTENCY CHECK
            ---------------------------------------------
            */

            if (
                idempotencyRef
            ) {

                const existingKey =
                    await transaction.get(
                        idempotencyRef
                    );


                if (
                    existingKey.exists
                ) {

                    const existingData =
                        existingKey.data();


                    if (
                        existingData.orderId
                    ) {

                        throw new Error(
                            "Checkout already exists for this idempotency key."
                        );

                    }

                }


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

        sellerIds:
            sellerBreakdown.map(
                seller =>
                    seller.sellerId
            ),

        subtotal,

        deliveryFee,

        buyerTotal,

        commissionAmount:
            totalCommission,

        sellerGross:
            totalSellerGross,

        sellerNet:
            money(
                totalSellerGross -
                totalCommission
            ),

        message:
            "Checkout created successfully. Proceed to payment.",

    };

}


/*
=========================================================
SAFE IDEMPOTENCY ID
=========================================================

Firestore document IDs cannot contain "/".

We therefore convert the client key into a safe
deterministic identifier.

This does NOT replace cryptographic idempotency.
It only makes the document ID safe.
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
GET CHECKOUT / ORDER
=========================================================
*/

async function getCheckout({

    orderId,

    buyerId,

}) {

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


    const orderRef =
        db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(orderId);


    const snapshot =
        await orderRef.get();


    if (
        !snapshot.exists
    ) {

        return null;

    }


    const order =
        snapshot.data();


    /*
    =====================================================
    BUYER AUTHORIZATION
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