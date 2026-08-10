const {
    db
} = require("../config/firebase");


/*
=========================================================
PROCESS SUCCESSFUL MARKETPLACE PAYMENT
=========================================================

IMPORTANT:

This service does NOT release money to the seller.

It only confirms that the buyer payment was received.

Seller money remains:

    sellerPaymentStatus = NOT_RELEASED

until the order is completed.

=========================================================
*/

async function processMarketplacePayment({

    orderId,

    providerTransactionId,

    amount,

    paymentMethod = "MPESA",

    providerResponse = null,

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


    if (!providerTransactionId) {

        throw new Error(
            "Provider transaction ID is required."
        );

    }


    const paidAmount =
        Number(amount);


    if (
        !Number.isFinite(paidAmount) ||
        paidAmount <= 0
    ) {

        throw new Error(
            "Invalid payment amount."
        );

    }


    /*
    =====================================================
    REFERENCES
    =====================================================
    */

    const orderRef =
        db
            .collection("orders")
            .doc(orderId);


    const orderSnap =
        await orderRef.get();


    if (!orderSnap.exists) {

        throw new Error(
            "Order not found."
        );

    }


    const order =
        orderSnap.data();


    /*
    =====================================================
    AMOUNT VERIFICATION
    =====================================================

    Never trust the frontend.

    The amount received from the payment provider
    must match the amount expected by the order.
    =====================================================
    */

    const expectedAmount =
        Number(
            order.buyerTotal
        );


    if (
        Math.abs(
            paidAmount -
            expectedAmount
        ) > 0.01
    ) {

        throw new Error(
            `Payment amount mismatch. Expected KES ${expectedAmount}, received KES ${paidAmount}.`
        );

    }


    /*
    =====================================================
    PROVIDER TRANSACTION ID
    =====================================================
    */

    const providerRef =
        db
            .collection("payments")
            .where(
                "providerTransactionId",
                "==",
                providerTransactionId
            )
            .limit(1);


    const existingProviderPayment =
        await providerRef.get();


    /*
    =====================================================
    IDEMPOTENCY
    =====================================================

    If this callback has already been processed,
    DO NOTHING.
    =====================================================
    */

    if (
        !existingProviderPayment.empty
    ) {

        const existing =
            existingProviderPayment
                .docs[0]
                .data();


        return {

            success: true,

            alreadyProcessed: true,

            orderId,

            paymentId:
                existing.paymentId,

            providerTransactionId,

        };

    }


    /*
    =====================================================
    PAYMENT RECORD
    =====================================================
    */

    const paymentId =
        order.paymentId ||
        `PAY-${Date.now()}-${Math.random()
            .toString(36)
            .substring(2, 8)
            .toUpperCase()}`;


    const paymentRef =
        db
            .collection("payments")
            .doc(paymentId);


    const transactionId =
        `SALE-${Date.now()}-${Math.random()
            .toString(36)
            .substring(2, 8)
            .toUpperCase()}`;


    const transactionRef =
        db
            .collection("marketplaceTransactions")
            .doc(transactionId);


    const now =
        new Date();


    /*
    =====================================================
    ATOMIC PAYMENT PROCESSING
    =====================================================
    */

    await db.runTransaction(
        async (marketplaceTransaction) => {


            /*
            ---------------------------------------------
            RE-READ ORDER
            ---------------------------------------------
            */

            const freshOrderSnap =
                await transaction.get(
                    orderRef
                );


            if (
                !freshOrderSnap.exists
            ) {

                throw new Error(
                    "Order no longer exists."
                );

            }


            const freshOrder =
                freshOrderSnap.data();


            /*
            ---------------------------------------------
            ALREADY PAID?
            ---------------------------------------------
            */

            if (
                freshOrder.paymentStatus ===
                "COMPLETED"
            ) {

                return;

            }


            /*
            ---------------------------------------------
            UPDATE ORDER
            ---------------------------------------------
            */

            transaction.update(
                orderRef,
                {

                    status:
                        "PAID",

                    paymentStatus:
                        "COMPLETED",

                    paymentCompletedAt:
                        now,

                    providerTransactionId,

                    paymentMethod,

                    updatedAt:
                        now,

                }
            );


            /*
            ---------------------------------------------
            UPDATE PAYMENT
            ---------------------------------------------
            */

            transaction.set(
                paymentRef,
                {

                    paymentId,

                    orderId,

                    buyerId:
                        freshOrder.buyerId,

                    sellerId:
                        freshOrder.sellerId,

                    amount:
                        paidAmount,

                    currency:
                        "KES",

                    method:
                        paymentMethod,

                    provider:
                        paymentMethod === "MPESA"
                            ? "INTASEND"
                            : paymentMethod,

                    providerTransactionId,

                    status:
                        "COMPLETED",

                    providerResponse:
                        providerResponse ||
                        null,

                    completedAt:
                        now,

                    updatedAt:
                        now,

                },
                {
                    merge: true
                }
            );


            /*
            ---------------------------------------------
            FINANCIAL LEDGER
            ---------------------------------------------
            */

            transaction.set(
                transactionRef,
                {

                    transactionId,

                    type:
                        "MARKETPLACE_SALE",

                    orderId,

                    paymentId,

                    buyerId:
                        freshOrder.buyerId,

                    sellerId:
                        freshOrder.sellerId,

                    listingId:
                        freshOrder.listingId,

                    amount:
                        paidAmount,

                    currency:
                        "KES",

                    commissionRate:
                        freshOrder.commissionRate,

                    commissionAmount:
                        freshOrder.commissionAmount,

                    sellerGross:
                        freshOrder.sellerGross,

                    sellerNet:
                        freshOrder.sellerNet,

                    paymentMethod,

                    providerTransactionId,

                    status:
                        "COMPLETED",

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

        alreadyProcessed: false,

        orderId,

        paymentId,

        transactionId,

        providerTransactionId,

        amount:
            paidAmount,

        commissionAmount:
            Number(
                order.commissionAmount || 0
            ),

        sellerAmount:
            Number(
                order.sellerNet || 0
            ),

        status:
            "PAID",

    };

}


/*
=========================================================
GET PAYMENT
=========================================================
*/

async function getPayment(paymentId) {

    if (!paymentId) {

        throw new Error(
            "Payment ID is required."
        );

    }


    const snap =
        await db
            .collection("payments")
            .doc(paymentId)
            .get();


    if (!snap.exists) {

        return null;

    }


    return {

        id: snap.id,

        ...snap.data(),

    };

}


module.exports = {

    processMarketplacePayment,

    getPayment,

};