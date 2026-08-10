const {
    db
} = require("../config/firebase");

const {
    calculateCommission
} = require("./marketplaceCommission");


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
CREATE MARKETPLACE ORDER
=========================================================
*/

async function createMarketplaceOrder({

    buyerId,

    listingId,

    quantity = 1,

    deliveryFee = 0,

    paymentMethod = "MPESA",

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
    GET LISTING
    =====================================================
    */

    const listingRef =
        db
            .collection("marketListings")
            .doc(listingId);


    const listingSnap =
        await listingRef.get();


    if (!listingSnap.exists) {

        throw new Error(
            "Marketplace listing not found."
        );

    }


    const listing =
        listingSnap.data();


    /*
    =====================================================
    VERIFY SELLER
    =====================================================
    */

    const sellerId =
        listing.sellerId ||
        listing.userId ||
        listing.ownerId;


    if (!sellerId) {

        throw new Error(
            "This listing does not have a valid seller."
        );

    }


    if (sellerId === buyerId) {

        throw new Error(
            "You cannot purchase your own listing."
        );

    }


    /*
    =====================================================
    GET PRICE
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
            "This listing has an invalid price."
        );

    }


    /*
    =====================================================
    CHECK STOCK
    =====================================================
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
            stock < orderQuantity
        ) {

            throw new Error(
                "Insufficient stock."
            );

        }

    }


    /*
    =====================================================
    CALCULATE TOTAL
    =====================================================
    */

    const subtotal =
        Number(
            (
                unitPrice *
                orderQuantity
            ).toFixed(2)
        );


    const buyerTotal =
        Number(
            (
                subtotal +
                delivery
            ).toFixed(2)
        );


    /*
    =====================================================
    CATEGORY
    =====================================================
    */

    const category =
        listing.category ||
        listing.categoryName ||
        "general";


    /*
    =====================================================
    COMMISSION

    Commission is calculated against the product/
    service value.

    Delivery is NOT included in commission.
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
    ORDER ID
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
            .collection("marketplaceOrders")
            .doc(orderId);


    const paymentRef =
        db
            .collection("marketplacePayments")
            .doc(paymentId);


    const now =
        new Date();


    /*
    =====================================================
    CREATE ORDER + PAYMENT ATOMICALLY
    =====================================================
    */

    await db.runTransaction(
        async (marketplaceTransaction) => {


            /*
            ---------------------------------------------
            RECHECK LISTING INSIDE TRANSACTION
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
                    "Listing no longer exists."
                );

            }


            const freshListing =
                freshListingSnap.data();


            /*
            ---------------------------------------------
            RECHECK STOCK
            ---------------------------------------------
            */

            if (
                freshListing.stock !==
                    undefined &&
                freshListing.stock !==
                    null
            ) {

                const currentStock =
                    Number(
                        freshListing.stock
                    );


                if (
                    currentStock <
                    orderQuantity
                ) {

                    throw new Error(
                        "The requested quantity is no longer available."
                    );

                }


                /*
                -----------------------------------------
                RESERVE STOCK
                -----------------------------------------
                */

                transaction.update(
                    listingRef,
                    {

                        stock:
                            currentStock -
                            orderQuantity,

                        updatedAt:
                            now,

                    }
                );

            }


            /*
            ---------------------------------------------
            ORDER
            ---------------------------------------------
            */

            transaction.set(
                orderRef,
                {

                    orderId,

                    buyerId,

                    sellerId,

                    listingId,

                    productName:
                        listing.name ||
                        listing.title ||
                        "Marketplace Item",

                    productImage:
                        listing.image ||
                        listing.imageUrl ||
                        null,

                    category:
                        commission.category,

                    quantity:
                        orderQuantity,

                    unitPrice,

                    subtotal,

                    deliveryFee:
                        delivery,

                    buyerTotal,

                    /*
                    -------------------------------------
                    FINANCIAL BREAKDOWN
                    -------------------------------------
                    */

                    commissionRate:
                        commission.commissionRate,

                    commissionPercentage:
                        commission.commissionPercentage,

                    commissionAmount:
                        commission.commissionAmount,

                    sellerGross:
                        commission.sellerGross,

                    sellerNet:
                        commission.sellerGross,

                    /*
                    -------------------------------------
                    STATUS
                    -------------------------------------
                    */

                    status:
                        "PENDING_PAYMENT",

                    paymentStatus:
                        "PENDING",

                    sellerPaymentStatus:
                        "NOT_RELEASED",

                    payoutStatus:
                        "NOT_RELEASED",

                    refundStatus:
                        "NOT_REFUNDED",

                    paymentId,

                    paymentMethod,

                    createdAt:
                        now,

                    updatedAt:
                        now,

                }
            );


            /*
            ---------------------------------------------
            PAYMENT RECORD
            ---------------------------------------------
            */

            transaction.set(
                paymentRef,
                {

                    paymentId,

                    orderId,

                    buyerId,

                    sellerId,

                    amount:
                        buyerTotal,

                    currency:
                        "KES",

                    method:
                        paymentMethod,

                    provider:
                        paymentMethod === "MPESA"
                            ? "INTASEND"
                            : paymentMethod,

                    status:
                        "PENDING",

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

        orderId,

        paymentId,

        buyerId,

        sellerId,

        listingId,

        quantity:
            orderQuantity,

        subtotal,

        deliveryFee:
            delivery,

        buyerTotal,

        commissionRate:
            commission.commissionRate,

        commissionAmount:
            commission.commissionAmount,

        sellerGross:
            commission.sellerGross,

        sellerNet:
            commission.sellerGross,

        status:
            "PENDING_PAYMENT",

        paymentStatus:
            "PENDING",

    };

}


module.exports = {

    createMarketplaceOrder,

};