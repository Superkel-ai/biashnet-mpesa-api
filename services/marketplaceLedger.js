const { db } = require("../config/firebase");
const { FieldValue } = require("firebase-admin/firestore");


/*
==================================================
MARKETPLACE LEDGER
==================================================

Collection:
marketplaceLedger

This is COMPLETELY SEPARATE from:

investor transactions
investor wallets
withdrawalRequests

Ledger entries should never be deleted.
==================================================
*/


/*
==================================================
CREATE LEDGER ENTRY
==================================================
*/

async function createLedgerEntry({

    type,

    orderId = null,

    paymentId = null,

    sellerId = null,

    buyerId = null,

    amount = 0,

    commission = 0,

    netAmount = 0,

    reference = null,

    description = "",

    status = "COMPLETED",

    metadata = {},

}) {

    const ledgerRef =
        db
            .collection("marketplaceLedger")
            .doc();


    const entry = {

        ledgerId:
            ledgerRef.id,

        type,

        orderId,

        paymentId,

        sellerId,

        buyerId,

        amount:
            Number(amount) || 0,

        commission:
            Number(commission) || 0,

        netAmount:
            Number(netAmount) || 0,

        reference,

        description,

        status,

        metadata,

        createdAt:
            FieldValue.serverTimestamp(),

    };


    await ledgerRef.set(entry);


    return {

        ledgerId:
            ledgerRef.id,

        ...entry,

    };

}


/*
==================================================
PAYMENT RECEIVED
==================================================
*/

async function recordPaymentLedger({

    orderId,

    paymentId,

    buyerId,

    sellerId,

    amount,

    reference,

}) {

    return createLedgerEntry({

        type:
            "ORDER_PAYMENT",

        orderId,

        paymentId,

        buyerId,

        sellerId,

        amount,

        commission: 0,

        netAmount: amount,

        reference,

        description:
            "Marketplace payment received from buyer.",

        status:
            "COMPLETED",

    });

}


/*
==================================================
COMMISSION
==================================================
*/

async function recordCommissionLedger({

    orderId,

    paymentId,

    buyerId,

    sellerId,

    amount,

    commission,

    reference,

    category,

}) {

    return createLedgerEntry({

        type:
            "COMMISSION",

        orderId,

        paymentId,

        buyerId,

        sellerId,

        amount,

        commission,

        netAmount:
            Number(commission),

        reference,

        description:
            `BIASHNET marketplace commission - ${category || "General"}`,

        status:
            "COMPLETED",

        metadata: {

            category,

        },

    });

}


/*
==================================================
SELLER CREDIT
==================================================
*/

async function recordSellerCreditLedger({

    orderId,

    sellerId,

    amount,

    commission,

    reference,

}) {

    return createLedgerEntry({

        type:
            "SELLER_CREDIT",

        orderId,

        sellerId,

        amount,

        commission,

        netAmount:
            Number(amount) - Number(commission),

        reference,

        description:
            "Seller marketplace wallet credit.",

        status:
            "COMPLETED",

    });

}


/*
==================================================
SELLER WITHDRAWAL
==================================================
*/

async function recordSellerWithdrawalLedger({

    withdrawalId,

    sellerId,

    amount,

    transactionCost = 0,

    netAmount,

    reference,

}) {

    return createLedgerEntry({

        type:
            "SELLER_WITHDRAWAL",

        sellerId,

        amount,

        commission:
            transactionCost,

        netAmount,

        reference,

        description:
            "Marketplace seller withdrawal.",

        status:
            "PROCESSING",

        metadata: {

            withdrawalId,

            transactionCost,

        },

    });

}


/*
==================================================
WITHDRAWAL COMPLETED
==================================================
*/

async function recordWithdrawalCompletedLedger({

    withdrawalId,

    sellerId,

    amount,

    reference,

}) {

    return createLedgerEntry({

        type:
            "WITHDRAWAL_COMPLETED",

        sellerId,

        amount,

        netAmount:
            amount,

        reference,

        description:
            "Marketplace seller withdrawal completed.",

        status:
            "COMPLETED",

        metadata: {

            withdrawalId,

        },

    });

}


/*
==================================================
WITHDRAWAL FAILED
==================================================
*/

async function recordWithdrawalFailedLedger({

    withdrawalId,

    sellerId,

    amount,

    reference,

}) {

    return createLedgerEntry({

        type:
            "WITHDRAWAL_FAILED",

        sellerId,

        amount,

        netAmount:
            amount,

        reference,

        description:
            "Marketplace seller withdrawal failed and funds were returned.",

        status:
            "FAILED",

        metadata: {

            withdrawalId,

        },

    });

}


module.exports = {

    createLedgerEntry,

    recordPaymentLedger,

    recordCommissionLedger,

    recordSellerCreditLedger,

    recordSellerWithdrawalLedger,

    recordWithdrawalCompletedLedger,

    recordWithdrawalFailedLedger,

};