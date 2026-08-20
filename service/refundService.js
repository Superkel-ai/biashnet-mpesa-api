const {
    db
} = require("../config/firebase");

const {
    COLLECTIONS
} = require("../config/collections");

const {
    PAYMENT_STATUS,
    ORDER_STATUS,
    SELLER_PAYMENT_STATUS,
    PAYOUT_STATUS,
    TRANSACTION_TYPES
} = require("../config/paymentConstants");

const {
    generateRefundId,
    generateTransactionId
} = require("../utils/codeGenerator");

/*
=========================================================
REFUND SERVICE
=========================================================

RESPONSIBILITY

Handles marketplace payment refunds.

FLOW:

Payment completed
       ↓
Refund requested
       ↓
Validate order
       ↓
Validate payment
       ↓
Check duplicate refund
       ↓
Determine refundable amount
       ↓
Create refund record
       ↓
Reverse seller-held funds
       ↓
Create financial transaction
       ↓
Mark order refunded
       ↓
Mark payment refunded

IMPORTANT:

This service records the refund internally.

Actual M-PESA/provider money reversal should be
performed by a provider-specific refund/transfer
service when that capability is configured.

DO NOT pretend that money was returned to the buyer
just because Firestore was updated.
=========================================================
*/


/*
=========================================================
HELPER
=========================================================
*/

function money(value) {

    const number =
        Number(value);


    if (
        !Number.isFinite(number)
    ) {

        return 0;

    }


    return Number(
        number.toFixed(2)
    );

}


/*
=========================================================
GET EXISTING REFUNDS
=========================================================
*/

async function getExistingRefunds(
    orderId
) {

    const snapshot =
        await db
            .collection(
                COLLECTIONS.REFUNDS
            )
            .where(
                "orderId",
                "==",
                orderId
            )
            .get();


    let totalRefunded =
        0;


    const refunds = [];


    snapshot.forEach(
        (doc) => {

            const data =
                doc.data();


            /*
            Only successful/processed refunds
            count against refundable amount.
            */

            if (
                data.status ===
                    "COMPLETED" ||
                data.status ===
                    "PROCESSING"
            ) {

                totalRefunded =
                    money(
                        totalRefunded +
                        Number(
                            data.amount || 0
                        )
                    );

            }


            refunds.push({

                id:
                    doc.id,

                ...data

            });

        }
    );


    return {

        totalRefunded,

        refunds

    };

}


/*
=========================================================
CREATE REFUND
=========================================================
*/

async function createRefund({

    orderId,

    requestedBy,

    reason,

    amount = null,

    refundType = "FULL",

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


    if (!requestedBy) {

        throw new Error(
            "Refund requester is required."
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
            .doc(orderId);


    const orderSnap =
        await orderRef.get();


    if (
        !orderSnap.exists
    ) {

        throw new Error(
            "Marketplace order not found."
        );

    }


    const order =
        orderSnap.data();


    /*
    =====================================================
    ONLY PAID ORDERS
    =====================================================
    */

    if (
        order.paymentStatus !==
        PAYMENT_STATUS.COMPLETED
    ) {

        throw new Error(
            "Only completed payments can be refunded."
        );

    }


    /*
    =====================================================
    PAYMENT ID
    =====================================================
    */

    if (!order.paymentId) {

        throw new Error(
            "Order has no payment record."
        );

    }


    const paymentRef =
        db
            .collection(
                COLLECTIONS.PAYMENTS
            )
            .doc(
                order.paymentId
            );


    const paymentSnap =
        await paymentRef.get();


    if (
        !paymentSnap.exists
    ) {

        throw new Error(
            "Payment record not found."
        );

    }


    const payment =
        paymentSnap.data();


    /*
    =====================================================
    EXISTING REFUNDS
    =====================================================
    */

    const existing =
        await getExistingRefunds(
            orderId
        );


    const paidAmount =
        money(
            payment.amount ||
            order.buyerTotal
        );


    const remainingRefundable =
        money(
            paidAmount -
            existing.totalRefunded
        );


    if (
        remainingRefundable <= 0
    ) {

        throw new Error(
            "This payment has already been fully refunded."
        );

    }


    /*
    =====================================================
    DETERMINE REFUND AMOUNT
    =====================================================
    */

    let refundAmount;


    if (
        refundType === "FULL"
    ) {

        refundAmount =
            remainingRefundable;

    } else {

        refundAmount =
            money(amount);

    }


    /*
    =====================================================
    VALIDATE PARTIAL REFUND
    =====================================================
    */

    if (
        !Number.isFinite(
            refundAmount
        ) ||
        refundAmount <= 0
    ) {

        throw new Error(
            "Invalid refund amount."
        );

    }


    if (
        refundAmount >
        remainingRefundable
    ) {

        throw new Error(
            `Refund amount exceeds the remaining refundable amount of KES ${remainingRefundable}.`
        );

    }


    /*
    =====================================================
    REFUND ID
    =====================================================
    */

    const refundId =
        generateRefundId();


    const transactionId =
        generateTransactionId();


    const refundRef =
        db
            .collection(
                COLLECTIONS.REFUNDS
            )
            .doc(
                refundId
            );


    const transactionRef =
        db
            .collection(
                COLLECTIONS.TRANSACTIONS
            )
            .doc(
                transactionId
            );


    const now =
        new Date();


    /*
    =====================================================
    CREATE REFUND

    IMPORTANT:

    We initially create the refund as PENDING.

    The actual provider refund can later change it to:

    PROCESSING
    COMPLETED
    FAILED
    =====================================================
    */

    const refundData = {

        refundId,

        orderId,

        paymentId:
            order.paymentId,

        buyerId:
            order.buyerId,

        sellerId:
            order.sellerId ||
            null,

        amount:
            refundAmount,

        currency:
            "KES",

        refundType,

        reason:
            reason ||
            "Marketplace refund",

        requestedBy,

        provider:
            payment.provider ||
            "MPESA",

        providerTransactionId:
            payment.providerTransactionId ||
            null,

        status:
            "PENDING",

        createdAt:
            now,

        updatedAt:
            now,

    };


    /*
    =====================================================
    ATOMIC REFUND CREATION
    =====================================================
    */

    await db.runTransaction(
        async (transaction) => {

            /*
            ------------------------------------------------
            RE-READ ORDER
            ------------------------------------------------
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
            ------------------------------------------------
            PROTECT AGAINST DOUBLE REFUND
            ------------------------------------------------
            */

            if (
                freshOrder.paymentStatus ===
                PAYMENT_STATUS.REFUNDED
            ) {

                throw new Error(
                    "Order has already been refunded."
                );

            }


            /*
            ------------------------------------------------
            CREATE REFUND
            ------------------------------------------------
            */

            transaction.set(
                refundRef,
                refundData
            );


            /*
            ------------------------------------------------
            CREATE FINANCIAL TRANSACTION
            ------------------------------------------------
            */

            transaction.set(
                transactionRef,
                {

                    transactionId,

                    type:
                        TRANSACTION_TYPES.REFUND,

                    orderId,

                    paymentId:
                        order.paymentId,

                    refundId,

                    buyerId:
                        freshOrder.buyerId,

                    sellerId:
                        freshOrder.sellerId ||
                        null,

                    amount:
                        refundAmount,

                    currency:
                        "KES",

                    status:
                        "PENDING",

                    reason:
                        reason ||
                        "Marketplace refund",

                    createdAt:
                        now,

                    updatedAt:
                        now,

                }
            );


            /*
            ------------------------------------------------
            MARK ORDER REFUNDING
            ------------------------------------------------
            */

            transaction.update(
                orderRef,
                {

                    paymentStatus:
                        "REFUND_PENDING",

                    sellerPaymentStatus:
                        SELLER_PAYMENT_STATUS.REFUNDED,

                    payoutStatus:
                        PAYOUT_STATUS.NOT_RELEASED,

                    refundId,

                    refundAmount,

                    updatedAt:
                        now,

                }
            );


            /*
            ------------------------------------------------
            MARK PAYMENT REFUNDING
            ------------------------------------------------
            */

            transaction.update(
                paymentRef,
                {

                    status:
                        "REFUND_PENDING",

                    refundId,

                    refundAmount,

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

        success:
            true,

        refundId,

        transactionId,

        orderId,

        paymentId:
            order.paymentId,

        amount:
            refundAmount,

        currency:
            "KES",

        status:
            "PENDING",

        message:
            "Refund request created successfully. Provider refund processing is pending.",

    };

}


/*
=========================================================
COMPLETE REFUND
=========================================================

Called AFTER the actual payment provider confirms
that the money has been returned.

Do NOT call this merely because a refund was requested.
=========================================================
*/

async function completeRefund({

    refundId,

    providerRefundId = null,

    providerResponse = null,

}) {

    if (!refundId) {

        throw new Error(
            "Refund ID is required."
        );

    }


    const refundRef =
        db
            .collection(
                COLLECTIONS.REFUNDS
            )
            .doc(
                refundId
            );


    const refundSnap =
        await refundRef.get();


    if (
        !refundSnap.exists
    ) {

        throw new Error(
            "Refund not found."
        );

    }


    const refund =
        refundSnap.data();


    /*
    =====================================================
    DUPLICATE PROTECTION
    =====================================================
    */

    if (
        refund.status ===
        "COMPLETED"
    ) {

        return {

            success:
                true,

            alreadyCompleted:
                true,

            refundId

        };

    }


    const orderRef =
        db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(
                refund.orderId
            );


    const paymentRef =
        db
            .collection(
                COLLECTIONS.PAYMENTS
            )
            .doc(
                refund.paymentId
            );


    const transactionId =
        refund.transactionId ||
        generateTransactionId();


    const transactionRef =
        db
            .collection(
                COLLECTIONS.TRANSACTIONS
            )
            .doc(
                transactionId
            );


    const now =
        new Date();


    /*
    =====================================================
    ATOMIC COMPLETION
    =====================================================
    */

    await db.runTransaction(
        async (transaction) => {

            const freshRefundSnap =
                await transaction.get(
                    refundRef
                );


            if (
                !freshRefundSnap.exists
            ) {

                throw new Error(
                    "Refund no longer exists."
                );

            }


            const freshRefund =
                freshRefundSnap.data();


            if (
                freshRefund.status ===
                "COMPLETED"
            ) {

                return;

            }


            /*
            ---------------------------------------------
            REFUND
            ---------------------------------------------
            */

            transaction.update(
                refundRef,
                {

                    status:
                        "COMPLETED",

                    providerRefundId,

                    providerResponse:
                        providerResponse ||
                        null,

                    completedAt:
                        now,

                    updatedAt:
                        now,

                }
            );


            /*
            ---------------------------------------------
            ORDER
            ---------------------------------------------
            */

            transaction.update(
                orderRef,
                {

                    status:
                        ORDER_STATUS.REFUNDED,

                    paymentStatus:
                        PAYMENT_STATUS.REFUNDED,

                    sellerPaymentStatus:
                        SELLER_PAYMENT_STATUS.REFUNDED,

                    payoutStatus:
                        PAYOUT_STATUS.NOT_RELEASED,

                    refundedAmount:
                        freshRefund.amount,

                    refundedAt:
                        now,

                    updatedAt:
                        now,

                }
            );


            /*
            ---------------------------------------------
            PAYMENT
            ---------------------------------------------
            */

            transaction.update(
                paymentRef,
                {

                    status:
                        PAYMENT_STATUS.REFUNDED,

                    refundedAmount:
                        freshRefund.amount,

                    refundedAt:
                        now,

                    updatedAt:
                        now,

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
                        TRANSACTION_TYPES.REFUND,

                    orderId:
                        freshRefund.orderId,

                    paymentId:
                        freshRefund.paymentId,

                    refundId,

                    buyerId:
                        freshRefund.buyerId,

                    sellerId:
                        freshRefund.sellerId ||
                        null,

                    amount:
                        Number(
                            freshRefund.amount
                        ),

                    currency:
                        "KES",

                    status:
                        "COMPLETED",

                    providerRefundId,

                    provider:
                        freshRefund.provider,

                    createdAt:
                        now,

                    updatedAt:
                        now,

                }
            );

        }
    );


    return {

        success:
            true,

        refundId,

        transactionId,

        orderId:
            refund.orderId,

        amount:
            refund.amount,

        status:
            "COMPLETED",

        message:
            "Refund completed successfully."

    };

}


/*
=========================================================
FAIL REFUND
=========================================================

Used when the payment provider rejects/fails the refund.
=========================================================
*/

async function failRefund({

    refundId,

    reason,

    providerResponse = null,

}) {

    if (!refundId) {

        throw new Error(
            "Refund ID is required."
        );

    }


    const refundRef =
        db
            .collection(
                COLLECTIONS.REFUNDS
            )
            .doc(
                refundId
            );


    const refundSnap =
        await refundRef.get();


    if (
        !refundSnap.exists
    ) {

        throw new Error(
            "Refund not found."
        );

    }


    const refund =
        refundSnap.data();


    if (
        refund.status ===
        "COMPLETED"
    ) {

        throw new Error(
            "A completed refund cannot be marked failed."
        );

    }


    const orderRef =
        db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(
                refund.orderId
            );


    const paymentRef =
        db
            .collection(
                COLLECTIONS.PAYMENTS
            )
            .doc(
                refund.paymentId
            );


    const now =
        new Date();


    await db.runTransaction(
        async (transaction) => {

            transaction.update(
                refundRef,
                {

                    status:
                        "FAILED",

                    failureReason:
                        reason ||
                        "Provider refund failed.",

                    providerResponse:
                        providerResponse ||
                        null,

                    updatedAt:
                        now,

                }
            );


            /*
            ---------------------------------------------
            RETURN PAYMENT TO COMPLETED
            ---------------------------------------------

            The payment was never actually refunded.
            ---------------------------------------------
            */

            transaction.update(
                paymentRef,
                {

                    status:
                        PAYMENT_STATUS.COMPLETED,

                    refundId:
                        null,

                    updatedAt:
                        now,

                }
            );


            /*
            ---------------------------------------------
            RETURN ORDER TO PAID
            ---------------------------------------------
            */

            transaction.update(
                orderRef,
                {

                    paymentStatus:
                        PAYMENT_STATUS.COMPLETED,

                    sellerPaymentStatus:
                        SELLER_PAYMENT_STATUS.HELD,

                    payoutStatus:
                        PAYOUT_STATUS.NOT_RELEASED,

                    refundId:
                        null,

                    refundAmount:
                        0,

                    updatedAt:
                        now,

                }
            );

        }
    );


    return {

        success:
            true,

        refundId,

        status:
            "FAILED",

        message:
            "Refund failed and the original payment state was restored."

    };

}


/*
=========================================================
GET REFUND
=========================================================
*/

async function getRefund(
    refundId
) {

    if (!refundId) {

        throw new Error(
            "Refund ID is required."
        );

    }


    const snap =
        await db
            .collection(
                COLLECTIONS.REFUNDS
            )
            .doc(refundId)
            .get();


    if (
        !snap.exists
    ) {

        return null;

    }


    return {

        id:
            snap.id,

        ...snap.data()

    };

}


/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

    createRefund,

    completeRefund,

    failRefund,

    getRefund,

};