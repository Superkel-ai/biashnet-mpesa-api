const {
    db
} = require("../config/firebase");

const {
    calculateCommission
} = require("./marketplaceCommission");


/*
=========================================================
COLLECTIONS

IMPORTANT:
Marketplace uses its own collections.

DO NOT use:
- investor transactions
- investor wallets
- investor withdrawalRequests
=========================================================
*/

const PRODUCTS_COLLECTION =
    "products";

const ORDERS_COLLECTION =
    "marketplaceOrders";

const PAYMENTS_COLLECTION =
    "marketplacePayments";


/*
=========================================================
GENERATE ORDER ID
=========================================================
*/

function generateOrderId() {

    const timestamp =
        Date.now();

    const random =
        Math.random()
            .toString(36)
            .substring(2, 8)
            .toUpperCase();

    return `ORD-${timestamp}-${random}`;

}


/*
=========================================================
GENERATE PAYMENT ID
=========================================================
*/

function generatePaymentId() {

    const timestamp =
        Date.now();

    const random =
        Math.random()
            .toString(36)
            .substring(2, 8)
            .toUpperCase();

    return `PAY-${timestamp}-${random}`;

}


/*
=========================================================
ROUND MONEY
=========================================================
*/

function money(value) {

    return Number(
        Number(value || 0).toFixed(2)
    );

}


/*
=========================================================
CREATE MARKETPLACE ORDER
=========================================================

Buyer flow:

Firebase Auth
      ↓
req.user.uid
      ↓
buyerId
      ↓
products/{listingId}
      ↓
verify seller
      ↓
verify price
      ↓
verify stock
      ↓
calculate commission
      ↓
reserve stock
      ↓
create marketplace order
      ↓
create marketplace payment
=========================================================
*/

async function createMarketplaceOrder({

    buyerId,

    listingId,

    quantity = 1,

    deliveryFee = 0,

    paymentMethod = "MPESA",

    buyerPhone = "",

    deliveryLocation = "",

    deliveryNote = "",

}) {


    /*
    =====================================================
    VALIDATION
    =====================================================
    */

    if (!buyerId) {

        throw new Error(
            "Buyer ID is required."
        );

    }


    if (!listingId) {

        throw new Error(
            "Listing ID is required."
        );

    }


    const orderQuantity =
        Number(quantity);


    if (
        !Number.isInteger(
            orderQuantity
        ) ||
        orderQuantity <= 0
    ) {

        throw new Error(
            "Invalid order quantity."
        );

    }


    const delivery =
        Number(
            deliveryFee || 0
        );


    if (
        !Number.isFinite(delivery) ||
        delivery < 0
    ) {

        throw new Error(
            "Invalid delivery fee."
        );

    }


    /*
    =====================================================
    NORMALIZE PAYMENT METHOD
    =====================================================
    */

    const normalizedPaymentMethod =
        String(
            paymentMethod || "MPESA"
        )
        .trim()
        .toUpperCase();


    const allowedPaymentMethods = [
        "MPESA",
        "CARD",
        "WALLET"
    ];


    if (
        !allowedPaymentMethods.includes(
            normalizedPaymentMethod
        )
    ) {

        throw new Error(
            "Unsupported payment method."
        );

    }


    /*
    =====================================================
    PRODUCT REFERENCE
    =====================================================

    IMPORTANT:

    The Firestore document ID is the listingId.

    products/
        {listingId}

    We DO NOT search:

    where("id", "==", listingId)

    because id is not stored as a field.
    =====================================================
    */

    const listingRef =
        db
            .collection(
                PRODUCTS_COLLECTION
            )
            .doc(listingId);


    /*
    =====================================================
    READ PRODUCT
    =====================================================
    */

    const listingSnap =
        await listingRef.get();


    if (!listingSnap.exists) {

        throw new Error(
            "Marketplace product not found."
        );

    }


    const listing =
        listingSnap.data();


    /*
    =====================================================
    VERIFY PRODUCT STATUS
    =====================================================
    */

    if (
        listing.isActive === false
    ) {

        throw new Error(
            "This product is currently inactive."
        );

    }


    if (
        listing.status &&
        listing.status !== "approved"
    ) {

        throw new Error(
            "This product is not currently available for purchase."
        );

    }


    /*
    =====================================================
    VERIFY SELLER
    =====================================================

    Your products collection uses:

    userId = seller Firebase UID
    =====================================================
    */

    const sellerId =
        listing.userId;


    if (!sellerId) {

        throw new Error(
            "This product does not have a valid seller."
        );

    }


    /*
    =====================================================
    PREVENT SELF PURCHASE
    =====================================================
    */

    if (
        sellerId === buyerId
    ) {

        throw new Error(
            "You cannot purchase your own product."
        );

    }


    /*
    =====================================================
    SERVER-SIDE PRICE
    =====================================================

    NEVER trust price coming from React.

    The backend uses Firestore price.
    =====================================================
    */

    const unitPrice =
        Number(
            listing.price
        );


    if (
        !Number.isFinite(unitPrice) ||
        unitPrice <= 0
    ) {

        throw new Error(
            "This product has an invalid price."
        );

    }


    /*
    =====================================================
    STOCK
    =====================================================
    */

    let availableStock = null;


    if (
        listing.stock !== undefined &&
        listing.stock !== null
    ) {

        availableStock =
            Number(
                listing.stock
            );


        if (
            !Number.isFinite(
                availableStock
            ) ||
            availableStock < 0
        ) {

            throw new Error(
                "This product has invalid stock information."
            );

        }


        if (
            availableStock <
            orderQuantity
        ) {

            throw new Error(
                `Only ${availableStock} item(s) available.`
            );

        }

    }


    /*
    =====================================================
    CATEGORY
    =====================================================
    */

    const category =
        String(
            listing.category ||
            listing.categoryName ||
            "general"
        )
        .trim();


    /*
    =====================================================
    CALCULATE SUBTOTAL
    =====================================================
    */

    const subtotal =
        money(
            unitPrice *
            orderQuantity
        );


    /*
    =====================================================
    COMMISSION
    =====================================================

    Commission applies to the product/service value.

    Delivery fee is NOT included.
    =====================================================
    */

    const commission =
        await calculateCommission({

            amount:
                subtotal,

            category,

        });


    /*
    =====================================================
    BUYER TOTAL
    =====================================================
    */

    const buyerTotal =
        money(
            subtotal +
            delivery
        );


    /*
    =====================================================
    VERIFY COMMISSION RESPONSE
    =====================================================
    */

    const commissionAmount =
        money(
            commission.commissionAmount
        );


    const sellerGross =
        money(
            commission.sellerGross
        );


    if (
        commissionAmount < 0 ||
        sellerGross < 0
    ) {

        throw new Error(
            "Invalid commission calculation."
        );

    }


    /*
    =====================================================
    FINANCIAL CONSISTENCY CHECK
    =====================================================

    Product amount should equal:

    BIASHNET commission
           +
    seller gross
    =====================================================
    */

    const financialTotal =
        money(
            commissionAmount +
            sellerGross
        );


    if (
        Math.abs(
            financialTotal -
            subtotal
        ) > 0.01
    ) {

        throw new Error(
            "Commission calculation is financially inconsistent."
        );

    }


    /*
    =====================================================
    GENERATE IDS
    =====================================================
    */

    const orderId =
        generateOrderId();


    const paymentId =
        generatePaymentId();


    /*
    =====================================================
    REFERENCES
    =====================================================
    */

    const orderRef =
        db
            .collection(
                ORDERS_COLLECTION
            )
            .doc(orderId);


    const paymentRef =
        db
            .collection(
                PAYMENTS_COLLECTION
            )
            .doc(paymentId);


    const now =
        new Date();

/*
=========================================================
CREATE CART MARKETPLACE ORDER
=========================================================

Used by:

POST /api/marketplace/orders/cart

Frontend sends:

{
    items: [
        {
            listingId: "...",
            quantity: 2,
            color: "Black",
            size: "Large"
        },
        {
            listingId: "...",
            quantity: 1
        }
    ],

    deliveryFee: 0,

    paymentMethod: "MPESA",

    buyerPhone: "2547...",

    deliveryLocation: "Gate C",

    deliveryNote: "Call me",

    pickupStation: "JKUAT Gate C"
}

IMPORTANT:

buyerId is NEVER accepted from frontend.

It comes from Firebase authentication.
=========================================================
*/

async function createCartOrder({

    buyerId,

    items = [],

    deliveryFee = 0,

    paymentMethod = "MPESA",

    buyerPhone = "",

    deliveryLocation = "",

    deliveryNote = "",

    pickupStation = "",

}) {

    /*
    =====================================================
    VALIDATION
    =====================================================
    */

    if (!buyerId) {

        throw new Error(
            "Buyer ID is required."
        );

    }


    if (
        !Array.isArray(items) ||
        items.length === 0
    ) {

        throw new Error(
            "Your cart is empty."
        );

    }


    if (items.length > 50) {

        throw new Error(
            "Too many items in one order."
        );

    }


    const delivery =
        Number(deliveryFee || 0);


    if (
        !Number.isFinite(delivery) ||
        delivery < 0
    ) {

        throw new Error(
            "Invalid delivery fee."
        );

    }


    /*
    =====================================================
    PAYMENT METHOD
    =====================================================
    */

    const normalizedPaymentMethod =
        String(
            paymentMethod || "MPESA"
        )
        .trim()
        .toUpperCase();


    const allowedPaymentMethods = [
        "MPESA",
        "CARD",
        "WALLET"
    ];


    if (
        !allowedPaymentMethods.includes(
            normalizedPaymentMethod
        )
    ) {

        throw new Error(
            "Unsupported payment method."
        );

    }


    /*
    =====================================================
    BUYER DETAILS
    =====================================================
    */

    const cleanBuyerPhone =
        String(
            buyerPhone || ""
        ).trim();


    if (!cleanBuyerPhone) {

        throw new Error(
            "Buyer phone number is required."
        );

    }


    const cleanDeliveryLocation =
        String(
            deliveryLocation || ""
        ).trim();


    if (!cleanDeliveryLocation) {

        throw new Error(
            "Delivery location is required."
        );

    }


    /*
    =====================================================
    GENERATE MASTER ORDER
    =====================================================
    */

    const orderId =
        generateOrderId();


    const paymentId =
        generatePaymentId();


    const orderRef =
        db
            .collection(ORDERS_COLLECTION)
            .doc(orderId);


    const paymentRef =
        db
            .collection(PAYMENTS_COLLECTION)
            .doc(paymentId);


    const now =
        new Date();


    /*
    =====================================================
    LOAD ALL PRODUCTS
    =====================================================
    */

    const preparedItems = [];

    let subtotal = 0;

    let totalCommission = 0;

    let totalSellerGross = 0;


    for (
        const cartItem of items
    ) {

        const listingId =
            String(
                cartItem.listingId ||
                cartItem.productId ||
                ""
            ).trim();


        if (!listingId) {

            throw new Error(
                "A cart item is missing its listing ID."
            );

        }


        const quantity =
            Number(
                cartItem.quantity || 1
            );


        if (
            !Number.isInteger(quantity) ||
            quantity <= 0
        ) {

            throw new Error(
                `Invalid quantity for product ${listingId}.`
            );

        }


        /*
        ---------------------------------------------
        LOAD PRODUCT
        ---------------------------------------------
        */

        const listingRef =
            db
                .collection(
                    PRODUCTS_COLLECTION
                )
                .doc(listingId);


        const listingSnap =
            await listingRef.get();


        if (!listingSnap.exists) {

            throw new Error(
                `Product ${listingId} was not found.`
            );

        }


        const listing =
            listingSnap.data();


        /*
        ---------------------------------------------
        STATUS
        ---------------------------------------------
        */

        if (
            listing.isActive === false
        ) {

            throw new Error(
                `${listing.title || "Product"} is no longer active.`
            );

        }


        if (
            listing.status &&
            listing.status !== "approved"
        ) {

            throw new Error(
                `${listing.title || "Product"} is not available.`
            );

        }


        /*
        ---------------------------------------------
        SELLER
        ---------------------------------------------
        */

        const sellerId =
            listing.userId;


        if (!sellerId) {

            throw new Error(
                `${listing.title || "Product"} has no seller.`
            );

        }


        if (
            sellerId === buyerId
        ) {

            throw new Error(
                `You cannot purchase your own product: ${listing.title || listingId}.`
            );

        }


        /*
        ---------------------------------------------
        PRICE
        ---------------------------------------------
        */

        const unitPrice =
            Number(
                listing.price
            );


        if (
            !Number.isFinite(unitPrice) ||
            unitPrice <= 0
        ) {

            throw new Error(
                `Invalid price for ${listing.title || listingId}.`
            );

        }


        /*
        ---------------------------------------------
        STOCK
        ---------------------------------------------
        */

        if (
            listing.stock !== undefined &&
            listing.stock !== null
        ) {

            const stock =
                Number(
                    listing.stock
                );


            if (
                !Number.isFinite(stock) ||
                stock < quantity
            ) {

                throw new Error(
                    `Only ${stock} item(s) available for ${listing.title || listingId}.`
                );

            }

        }


        /*
        ---------------------------------------------
        PRODUCT TOTAL
        ---------------------------------------------
        */

        const itemSubtotal =
            money(
                unitPrice * quantity
            );


        /*
        ---------------------------------------------
        COMMISSION
        ---------------------------------------------
        */

        const commission =
            await calculateCommission({

                amount:
                    itemSubtotal,

                category:
                    String(
                        listing.category ||
                        listing.categoryName ||
                        "general"
                    ).trim(),

            });


        const commissionAmount =
            money(
                commission.commissionAmount
            );


        const sellerGross =
            money(
                commission.sellerGross
            );


        /*
        ---------------------------------------------
        PRODUCT SNAPSHOT
        ---------------------------------------------
        */

        const productImage =
            listing.images?.[0]?.thumb ||
            listing.images?.[0]?.full ||
            listing.image ||
            listing.imageUrl ||
            null;


        const productName =
            listing.title ||
            listing.name ||
            "Marketplace Item";


        preparedItems.push({

            listingId,

            sellerId,

            productName,

            productImage,

            category:
                listing.category ||
                listing.categoryName ||
                "general",

            quantity,

            unitPrice,

            subtotal:
                itemSubtotal,

            commissionRate:
                commission.commissionRate,

            commissionPercentage:
                commission.commissionPercentage,

            commissionAmount,

            sellerGross,

            sellerNet:
                sellerGross,

            /*
            Preserve buyer selections
            */

            color:
                cartItem.color ||
                null,

            size:
                cartItem.size ||
                null,

            variant:
                cartItem.variant ||
                null,

        });


        subtotal =
            money(
                subtotal +
                itemSubtotal
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

    }


    /*
    =====================================================
    BUYER TOTAL
    =====================================================
    */

    const buyerTotal =
        money(
            subtotal +
            delivery
        );


    /*
    =====================================================
    FINANCIAL CHECK
    =====================================================
    */

    const financialTotal =
        money(
            totalCommission +
            totalSellerGross
        );


    if (
        Math.abs(
            financialTotal -
            subtotal
        ) > 0.01
    ) {

        throw new Error(
            "Cart commission calculation is financially inconsistent."
        );

    }


    /*
    =====================================================
    ATOMIC STOCK + ORDER CREATION
    =====================================================
    */

    await db.runTransaction(
        async (transaction) => {

            /*
            ---------------------------------------------
            RECHECK EVERY PRODUCT
            ---------------------------------------------
            */

            for (
                const item of preparedItems
            ) {

                const listingRef =
                    db
                        .collection(
                            PRODUCTS_COLLECTION
                        )
                        .doc(
                            item.listingId
                        );


                const snap =
                    await transaction.get(
                        listingRef
                    );


                if (!snap.exists) {

                    throw new Error(
                        `${item.productName} is no longer available.`
                    );

                }


                const listing =
                    snap.data();


                /*
                RECHECK PRICE
                */

                const freshPrice =
                    Number(
                        listing.price
                    );


                if (
                    freshPrice !==
                    item.unitPrice
                ) {

                    throw new Error(
                        `The price of ${item.productName} has changed.`
                    );

                }


                /*
                RECHECK STOCK
                */

                if (
                    listing.stock !== undefined &&
                    listing.stock !== null
                ) {

                    const stock =
                        Number(
                            listing.stock
                        );


                    if (
                        !Number.isFinite(stock) ||
                        stock < item.quantity
                    ) {

                        throw new Error(
                            `Only ${stock} item(s) available for ${item.productName}.`
                        );

                    }


                    /*
                    RESERVE STOCK
                    */

                    transaction.update(
                        listingRef,
                        {

                            stock:
                                stock -
                                item.quantity,

                            updatedAt:
                                now,

                        }
                    );

                }

            }


            /*
            ---------------------------------------------
            CREATE MASTER ORDER
            ---------------------------------------------
            */

            transaction.set(
                orderRef,
                {

                    orderId,

                    buyerId,

                    /*
                    CART ORDER
                    */

                    orderType:
                        "CART",

                    items:
                        preparedItems,

                    itemCount:
                        preparedItems.length,

                    /*
                    FINANCIALS
                    */

                    subtotal,

                    deliveryFee:
                        delivery,

                    buyerTotal,

                    commissionAmount:
                        totalCommission,

                    sellerGross:
                        totalSellerGross,

                    /*
                    DELIVERY
                    */

                    buyerPhone:
                        cleanBuyerPhone,

                    deliveryLocation:
                        cleanDeliveryLocation,

                    deliveryNote:
                        String(
                            deliveryNote ||
                            ""
                        ).trim(),

                    pickupStation:
                        String(
                            pickupStation ||
                            ""
                        ).trim(),

                    /*
                    PAYMENT
                    */

                    paymentId,

                    paymentMethod:
                        normalizedPaymentMethod,

                    paymentStatus:
                        "PENDING",

                    status:
                        "PENDING_PAYMENT",

                    /*
                    MONEY FLOW
                    */

                    fundsReceived:
                        false,

                    fundsHeld:
                        false,

                    sellerWalletCredited:
                        false,

                    sellerPaymentStatus:
                        "NOT_RELEASED",

                    payoutStatus:
                        "NOT_RELEASED",

                    /*
                    DELIVERY
                    */

                    deliveryStatus:
                        "NOT_STARTED",

                    completionCodeStatus:
                        "NOT_GENERATED",

                    refundStatus:
                        "NOT_REFUNDED",

                    /*
                    TIMESTAMPS
                    */

                    createdAt:
                        now,

                    updatedAt:
                        now,

                }
            );


            /*
            ---------------------------------------------
            CREATE PAYMENT
            ---------------------------------------------
            */

            transaction.set(
                paymentRef,
                {

                    paymentId,

                    orderId,

                    buyerId,

                    /*
                    CART
                    */

                    orderType:
                        "CART",

                    itemCount:
                        preparedItems.length,

                    /*
                    AMOUNT
                    */

                    amount:
                        buyerTotal,

                    subtotal,

                    deliveryFee:
                        delivery,

                    currency:
                        "KES",

                    /*
                    METHOD
                    */

                    method:
                        normalizedPaymentMethod,

                    provider:
                        normalizedPaymentMethod ===
                        "MPESA"
                            ? "INTASEND"
                            : normalizedPaymentMethod,

                    /*
                    STATUS
                    */

                    status:
                        "PENDING",

                    resultCode:
                        null,

                    transactionId:
                        null,

                    merchantRequestId:
                        null,

                    checkoutRequestId:
                        null,

                    createdAt:
                        now,

                    updatedAt:
                        now,

                }
            );

        }
    );


    /*
    =====================================================
    RETURN TO ROUTE
    =====================================================
    */

    return {

        success: true,

        orderId,

        paymentId,

        orderType:
            "CART",

        subtotal,

        deliveryFee:
            delivery,

        buyerTotal,

        commissionAmount:
            totalCommission,

        sellerGross:
            totalSellerGross,

        itemCount:
            preparedItems.length,

        items:
            preparedItems,

        status:
            "PENDING_PAYMENT",

        paymentStatus:
            "PENDING",

    };

}
    /*
    =====================================================
    ATOMIC ORDER CREATION
    =====================================================

    This transaction:

    1. Re-reads product
    2. Re-checks stock
    3. Re-checks seller
    4. Re-checks price
    5. Reserves stock
    6. Creates order
    7. Creates payment record

    All happen atomically.
    =====================================================
    */

    await db.runTransaction(
        async (transaction) => {

            /*
            ---------------------------------------------
            RE-READ PRODUCT
            ---------------------------------------------
            */

            const freshListingSnap =
                await transaction.get(
                    listingRef
                );


            if (
                !freshListingSnap.exists
            ) {

                throw new Error(
                    "Product is no longer available."
                );

            }


            const freshListing =
                freshListingSnap.data();


            /*
            ---------------------------------------------
            PRODUCT STATUS
            ---------------------------------------------
            */

            if (
                freshListing.isActive === false
            ) {

                throw new Error(
                    "Product is no longer active."
                );

            }


            if (
                freshListing.status &&
                freshListing.status !== "approved"
            ) {

                throw new Error(
                    "Product is no longer available."
                );

            }


            /*
            ---------------------------------------------
            SELLER RECHECK
            ---------------------------------------------
            */

            const freshSellerId =
                freshListing.userId;


            if (!freshSellerId) {

                throw new Error(
                    "Product seller information is missing."
                );

            }


            if (
                freshSellerId !== sellerId
            ) {

                throw new Error(
                    "Product seller changed. Please try again."
                );

            }


            /*
            ---------------------------------------------
            PRICE RECHECK
            ---------------------------------------------
            */

            const freshPrice =
                Number(
                    freshListing.price
                );


            if (
                !Number.isFinite(
                    freshPrice
                ) ||
                freshPrice <= 0
            ) {

                throw new Error(
                    "Product price is invalid."
                );

            }


            /*
            ---------------------------------------------
            PREVENT PRICE RACE CONDITION
            ---------------------------------------------
            */

            if (
                freshPrice !== unitPrice
            ) {

                throw new Error(
                    "Product price has changed. Please refresh and try again."
                );

            }


            /*
            ---------------------------------------------
            STOCK RECHECK
            ---------------------------------------------
            */

            if (
    freshListing.stock !== undefined &&
    freshListing.stock !== null
) {

    const currentStock =
        Number(freshListing.stock);

    if (
        !Number.isFinite(currentStock) ||
        currentStock < orderQuantity
    ) {

        throw new Error(
            `Only ${currentStock} item(s) available.`
        );

    }

}
            /*
            ---------------------------------------------
            PRODUCT IMAGE
            ---------------------------------------------
            */

            const productImage =
                freshListing.images?.[0]?.thumb ||
                freshListing.images?.[0]?.full ||
                freshListing.image ||
                freshListing.imageUrl ||
                null;


            /*
            ---------------------------------------------
            PRODUCT TITLE
            ---------------------------------------------
            */

            const productName =
                freshListing.title ||
                freshListing.name ||
                "Marketplace Item";


            /*
            ---------------------------------------------
            CATEGORY
            ---------------------------------------------
            */

            const freshCategory =
                String(
                    freshListing.category ||
                    freshListing.categoryName ||
                    category ||
                    "general"
                )
                .trim();


            /*
            ---------------------------------------------
            ORDER DOCUMENT
            ---------------------------------------------
            */

            transaction.set(
                orderRef,
                {

                    /*
                    IDENTIFICATION
                    */

                    orderId,

                    listingId,

                    buyerId,

                    sellerId,


                    /*
                    PRODUCT SNAPSHOT
                    */

                    productName,

                    productImage,

                    category:
                        freshCategory,

                    quantity:
                        orderQuantity,

                    unitPrice,

                    subtotal,


                    /*
                    DELIVERY
                    */

                    deliveryFee:
                        delivery,

                    buyerTotal,

                    deliveryLocation:
                        String(
                            deliveryLocation ||
                            ""
                        ).trim(),

                    buyerPhone:
                        String(
                            buyerPhone ||
                            ""
                        ).trim(),

                    deliveryNote:
                        String(
                            deliveryNote ||
                            ""
                        ).trim(),


                    /*
                    FINANCIAL SNAPSHOT
                    */

                    commissionRate:
                        commission.commissionRate,

                    commissionPercentage:
                        commission.commissionPercentage,

                    commissionAmount,

                    sellerGross,

                    sellerNet:
                        sellerGross,


                    /*
                    MONEY FLOW STATUS
                    */

                    fundsReceived:
                        false,

                    fundsHeld:
                        false,

                    sellerWalletCredited:
                        false,

                    sellerPaymentStatus:
                        "NOT_RELEASED",

                    payoutStatus:
                        "NOT_RELEASED",


                    /*
                    ORDER STATUS
                    */

                    status:
                        "PENDING_PAYMENT",

                    paymentStatus:
                        "PENDING",

                    deliveryStatus:
                        "NOT_STARTED",

                    completionCodeStatus:
                        "NOT_GENERATED",

                    refundStatus:
                        "NOT_REFUNDED",


                    /*
                    PAYMENT
                    */

                    paymentId,

                    paymentMethod:
                        normalizedPaymentMethod,


                    /*
                    TIMESTAMPS
                    */

                    createdAt:
                        now,

                    updatedAt:
                        now,

                }
            );

/*
            ---------------------------------------------
            PAYMENT DOCUMENT
            ---------------------------------------------
            */

            transaction.set(
                paymentRef,
                {

                    paymentId,

                    orderId,

                    listingId,

                    buyerId,

                    sellerId,


                    /*
                    PAYMENT AMOUNT
                    */

                    amount:
                        buyerTotal,

                    subtotal,

                    deliveryFee:
                        delivery,

                    currency:
                        "KES",


                    /*
                    PAYMENT METHOD
                    */

                    method:
                        normalizedPaymentMethod,

                    provider:
                        normalizedPaymentMethod ===
                        "MPESA"
                            ? "INTASEND"
                            : normalizedPaymentMethod,


                    /*
                    PAYMENT STATUS
                    */

                    status:
                        "PENDING",

                    resultCode:
                        null,

                    transactionId:
                        null,

                    merchantRequestId:
                        null,

                    checkoutRequestId:
                        null,


                    /*
                    MONEY FLOW

                    Payment has NOT reached
                    BIASHNET yet.
                    */

                    receivedByPlatform:
                        false,

                    sellerWalletCredited:
                        false,

                    commissionRecorded:
                        false,


                    /*
                    TIMESTAMPS
                    */

                    createdAt:
                        now,

                    updatedAt:
                        now,

                }
            );

        }
    );


    /*
    =====================================================
    RETURN
    =====================================================
    */

    return {

        success: true,


        /*
        IDENTIFICATION
        */

        orderId,

        paymentId,

        listingId,

        buyerId,

        sellerId,


        /*
        PRODUCT
        */

        productName:
            listing.title ||
            listing.name ||
            "Marketplace Item",

        category,


        /*
        QUANTITY / PRICE
        */

        quantity:
            orderQuantity,

        unitPrice,

        subtotal,


        /*
        DELIVERY
        */

        deliveryFee:
            delivery,

        buyerTotal,


        /*
        COMMISSION
        */

        commissionRate:
            commission.commissionRate,

        commissionPercentage:
            commission.commissionPercentage,

        commissionAmount,

        sellerGross,

        sellerNet:
            sellerGross,


        /*
        STATUS
        */

        status:
            "PENDING_PAYMENT",

        paymentStatus:
            "PENDING",

    };

}


module.exports = {

    createMarketplaceOrder,
    createCartOrder,
};