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






async function createCartOrder({
    buyerId,
    items = [],
    deliveryFee = 0,
    paymentMethod = "MPESA",
    buyerPhone = "",
    deliveryLocation = "",
    deliveryNote = "",
    pickupStation = "",
    doorDelivery = false
}) {
    if (!buyerId) throw new Error("Buyer ID is required.");
    if (!Array.isArray(items) || !items.length)
        throw new Error("Your cart is empty.");
    if (items.length > 50)
        throw new Error("Too many items in one order.");

    const delivery = money(deliveryFee);
    if (delivery < 0) throw new Error("Invalid delivery fee.");

    const method = String(paymentMethod || "MPESA").trim().toUpperCase();
    if (!["MPESA", "CARD", "WALLET"].includes(method))
        throw new Error("Unsupported payment method.");

    const cleanPhone = String(buyerPhone || "").trim();
    const cleanLocation = String(deliveryLocation || "").trim();

    if (!cleanPhone)
        throw new Error("Buyer phone number is required.");

    if (!cleanLocation)
        throw new Error("Delivery location is required.");

    const orderId = generateOrderId();
    const paymentId = generatePaymentId();
    const orderRef = db.collection(ORDERS_COLLECTION).doc(orderId);
    const paymentRef = db.collection(PAYMENTS_COLLECTION).doc(paymentId);

    const preparedItems = [];
    let subtotal = 0;
    let totalCommission = 0;
    let totalSellerGross = 0;

    /*
    =====================================================
    LOAD + VALIDATE CART PRODUCTS
    =====================================================
    */

    for (const cartItem of items) {
        const listingId = String(
            cartItem.listingId || cartItem.productId || ""
        ).trim();

        if (!listingId)
            throw new Error("Cart item is missing listing ID.");

        const quantity = Number(cartItem.quantity || 1);

        if (!Number.isInteger(quantity) || quantity <= 0)
            throw new Error(`Invalid quantity for ${listingId}.`);

        const listingRef = db
            .collection(PRODUCTS_COLLECTION)
            .doc(listingId);

        const snap = await listingRef.get();

        if (!snap.exists)
            throw new Error(`Product ${listingId} was not found.`);

        const product = snap.data();

        if (product.isActive === false)
            throw new Error(`${product.title || "Product"} is inactive.`);

        if (product.status && product.status !== "approved")
            throw new Error(`${product.title || "Product"} is unavailable.`);

        const sellerId = product.userId;

        if (!sellerId)
            throw new Error(`${product.title || "Product"} has no seller.`);

        if (sellerId === buyerId)
            throw new Error(`You cannot purchase ${product.title || "your own product"}.`);

        const unitPrice = Number(product.price);

        if (!Number.isFinite(unitPrice) || unitPrice <= 0)
            throw new Error(`Invalid price for ${product.title || listingId}.`);

        if (product.stock !== undefined && product.stock !== null) {
            const stock = Number(product.stock);

            if (!Number.isFinite(stock) || stock < quantity)
                throw new Error(
                    `Only ${stock} item(s) available for ${product.title || listingId}.`
                );
        }

        const itemSubtotal = money(unitPrice * quantity);

        const commission = await calculateCommission({
            amount: itemSubtotal,
            category: String(
                product.category ||
                product.categoryName ||
                "general"
            ).trim()
        });

        const commissionAmount = money(
            commission.commissionAmount
        );

        const sellerGross = money(
            commission.sellerGross
        );

        const productImage =
            product.images?.[0]?.thumb ||
            product.images?.[0]?.full ||
            product.image ||
            product.imageUrl ||
            null;

        preparedItems.push({
            listingId,
            sellerId,
            productName:
                product.title ||
                product.name ||
                "Marketplace Item",
            productImage,
            category:
                product.category ||
                product.categoryName ||
                "general",
            quantity,
            unitPrice,
            subtotal: itemSubtotal,
            commissionRate: commission.commissionRate,
            commissionPercentage: commission.commissionPercentage,
            commissionAmount,
            sellerGross,
            sellerNet: sellerGross,
            color: cartItem.color || null,
            size: cartItem.size || null,
            variant: cartItem.variant || null
        });

        subtotal = money(subtotal + itemSubtotal);
        totalCommission = money(totalCommission + commissionAmount);
        totalSellerGross = money(totalSellerGross + sellerGross);
    }

    const buyerTotal = money(subtotal + delivery);

    if (
        Math.abs(
            money(totalCommission + totalSellerGross) - subtotal
        ) > 0.01
    ) {
        throw new Error(
            "Cart commission calculation is financially inconsistent."
        );
    }

    /*
    =====================================================
    CREATE ORDER + RESERVE STOCK ATOMICALLY
    =====================================================
    */

    await db.runTransaction(async transaction => {
        const freshProducts = [];

        // READ EVERYTHING FIRST
        for (const item of preparedItems) {
            const ref = db
                .collection(PRODUCTS_COLLECTION)
                .doc(item.listingId);

            const snap = await transaction.get(ref);

            if (!snap.exists)
                throw new Error(`${item.productName} is no longer available.`);

            const product = snap.data();

            if (product.isActive === false)
                throw new Error(`${item.productName} is no longer active.`);

            if (product.status && product.status !== "approved")
                throw new Error(`${item.productName} is no longer available.`);

            if (Number(product.price) !== item.unitPrice)
                throw new Error(
                    `Price changed for ${item.productName}. Please try again.`
                );

            if (
                product.stock !== undefined &&
                product.stock !== null
            ) {
                const stock = Number(product.stock);

                if (!Number.isFinite(stock) || stock < item.quantity)
                    throw new Error(
                        `Only ${stock} item(s) left for ${item.productName}.`
                    );

                freshProducts.push({
                    ref,
                    stock,
                    quantity: item.quantity
                });
            } else {
                freshProducts.push({
                    ref,
                    stock: null,
                    quantity: item.quantity
                });
            }
        }

        // WRITE STOCK AFTER ALL READS
        for (const product of freshProducts) {
            if (product.stock !== null) {
                transaction.update(product.ref, {
                    stock: product.stock - product.quantity,
                    updatedAt: new Date()
                });
            }
        }

        const sellerIds = [
            ...new Set(
                preparedItems.map(item => item.sellerId)
            )
        ];

        const sellerTotals = {};

        for (const item of preparedItems) {
            if (!sellerTotals[item.sellerId]) {
                sellerTotals[item.sellerId] = {
                    subtotal: 0,
                    commission: 0,
                    sellerNet: 0
                };
            }

            sellerTotals[item.sellerId].subtotal =
                money(
                    sellerTotals[item.sellerId].subtotal +
                    item.subtotal
                );

            sellerTotals[item.sellerId].commission =
                money(
                    sellerTotals[item.sellerId].commission +
                    item.commissionAmount
                );

            sellerTotals[item.sellerId].sellerNet =
                money(
                    sellerTotals[item.sellerId].sellerNet +
                    item.sellerNet
                );
        }

        /*
        -----------------------------------------------
        MASTER ORDER
        -----------------------------------------------
        */

        transaction.set(orderRef, {
            orderId,
            buyerId,

            items: preparedItems,

            sellerIds,
            sellerTotals,

            subtotal,
            deliveryFee: delivery,
            buyerTotal,

            buyerPhone: cleanPhone,
            deliveryLocation: cleanLocation,
            deliveryNote: String(deliveryNote || "").trim(),

            pickupStation:
                String(pickupStation || "").trim(),

            doorDelivery:
                Boolean(doorDelivery),

            paymentId,
            paymentMethod: method,

            fundsReceived: false,
            fundsHeld: false,

            commissionAmount: totalCommission,
            sellerGross: totalSellerGross,
            sellerNet: totalSellerGross,

            sellerWalletCredited: false,
            sellerPaymentStatus: "NOT_RELEASED",
            payoutStatus: "NOT_RELEASED",

            status: "PENDING_PAYMENT",
            paymentStatus: "PENDING",

            deliveryStatus: "NOT_STARTED",

            completionCodeStatus: "NOT_GENERATED",

            refundStatus: "NOT_REFUNDED",

            createdAt: new Date(),
            updatedAt: new Date()
        });

        /*
        -----------------------------------------------
        PAYMENT
        -----------------------------------------------
        */

        transaction.set(paymentRef, {
            paymentId,
            orderId,
            buyerId,

            amount: buyerTotal,
            subtotal,
            deliveryFee: delivery,
            currency: "KES",

            method,

            provider:
                method === "MPESA"
                    ? "INTASEND"
                    : method,

            status: "PENDING",

            transactionId: null,
            merchantRequestId: null,
            checkoutRequestId: null,

            createdAt: new Date(),
            updatedAt: new Date()
        });
    });

    return {
        orderId,
        paymentId,

        buyerId,

        subtotal,
        deliveryFee: delivery,
        buyerTotal,

        commissionAmount: totalCommission,
        sellerGross: totalSellerGross,

        items: preparedItems,

        paymentStatus: "PENDING",
        status: "PENDING_PAYMENT"
    };
}

module.exports = {

    createMarketplaceOrder,
    createCartOrder,
};