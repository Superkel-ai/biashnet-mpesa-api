const { db } =
    require("../config/firebase");

const {
    COLLECTIONS
} = require("../config/collections");

const {
    TRANSACTION_TYPES,
    PAYMENT_STATUS,
    PAYMENT_METHODS,
    PAYMENT_PROVIDERS
} =
    require("../config/paymentConstants");

const {
    generateTransactionId
} =
    require("../utils/codeGenerator");


/*
=========================================================
BIASHNET TRANSACTION SERVICE
=========================================================

PURPOSE
---------------------------------------------------------

This service creates and manages the permanent financial
ledger for BIASHNET marketplace payments.

IMPORTANT:

This service does NOT:

- initiate M-PESA
- send STK Push
- handle Firebase authentication
- release seller funds
- withdraw money
- generate orders
- complete orders

It records financial events.

MAIN FLOW:

M-PESA SUCCESS
      ↓
paymentService
      ↓
transactionService
      ↓
financial ledger
      ↓
settlementService


COLLECTION:

marketplaceTransactions
=========================================================
*/


/*
=========================================================
MONEY HELPER
=========================================================
*/

function toMoney(value) {

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
VALIDATE REQUIRED VALUE
=========================================================
*/

function requireValue(
    value,
    field
) {

    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {

        throw new Error(
            `${field} is required.`
        );

    }

}


/*
=========================================================
CREATE TRANSACTION
=========================================================

Creates one permanent financial transaction.

This function should normally be called after a payment
has been successfully verified.

Example:

KES 1,000 marketplace sale

Creates:

MARKETPLACE_SALE
amount = 1000
commission = 150
sellerGross = 850

=========================================================
*/

async function createTransaction({

    transactionId = null,

    type,

    orderId,

    paymentId,

    buyerId,

    sellerId,

    listingId,

    amount,

    currency = "KES",

    commissionRate = 0,

    commissionAmount = 0,

    sellerGross = 0,

    sellerNet = 0,

    paymentMethod =
        PAYMENT_METHODS.MPESA,

    provider =
        PAYMENT_PROVIDERS.MPESA,

    providerTransactionId = null,

    status =
        PAYMENT_STATUS.COMPLETED,

    metadata = {},

}) {

    /*
    =====================================================
    VALIDATION
    =====================================================
    */

    requireValue(
        type,
        "Transaction type"
    );

    requireValue(
        orderId,
        "Order ID"
    );

    requireValue(
        paymentId,
        "Payment ID"
    );

    requireValue(
        buyerId,
        "Buyer ID"
    );


    /*
    sellerId may be unnecessary for some future
    transaction types, but marketplace sales require it.
    */

    if (
        type ===
        TRANSACTION_TYPES.MARKETPLACE_SALE
    ) {

        requireValue(
            sellerId,
            "Seller ID"
        );

    }


    const transactionAmount =
        toMoney(amount);


    if (
        transactionAmount <= 0
    ) {

        throw new Error(
            "Transaction amount must be greater than zero."
        );

    }


    /*
    =====================================================
    FINANCIAL VALUES
    =====================================================
    */

    const normalizedCommissionRate =
        Number(
            commissionRate
        );


    if (
        !Number.isFinite(
            normalizedCommissionRate
        ) ||
        normalizedCommissionRate < 0 ||
        normalizedCommissionRate > 1
    ) {

        throw new Error(
            "Invalid commission rate."
        );

    }


    const normalizedCommission =
        toMoney(
            commissionAmount
        );


    const normalizedSellerGross =
        toMoney(
            sellerGross
        );


    const normalizedSellerNet =
        toMoney(
            sellerNet ||
            normalizedSellerGross
        );


    /*
    =====================================================
    FINANCIAL VALIDATION
    =====================================================

    Sale:

    amount
       =
    commission
       +
    seller gross
    =====================================================
    */

    if (
        type ===
        TRANSACTION_TYPES.MARKETPLACE_SALE
    ) {

        const calculatedTotal =
            toMoney(
                normalizedCommission +
                normalizedSellerGross
            );


        if (
            Math.abs(
                calculatedTotal -
                transactionAmount
            ) > 0.01
        ) {

            throw new Error(
                "Transaction financial values do not balance."
            );

        }


        if (
            normalizedSellerNet >
            normalizedSellerGross
        ) {

            throw new Error(
                "Seller net cannot exceed seller gross."
            );

        }

    }


    /*
    =====================================================
    TRANSACTION ID
    =====================================================
    */

    const finalTransactionId =
        transactionId ||
        generateTransactionId();


    const transactionRef =
        db
            .collection(
                COLLECTIONS.TRANSACTIONS
            )
            .doc(
                finalTransactionId
            );


    /*
    =====================================================
    DUPLICATE PROTECTION
    =====================================================
    */

    const existingSnap =
        await transactionRef.get();


    if (
        existingSnap.exists
    ) {

        return {

            success: true,

            alreadyExists: true,

            transactionId:
                finalTransactionId,

            transaction:
                {
                    id:
                        existingSnap.id,

                    ...existingSnap.data(),

                },

        };

    }


    /*
    =====================================================
    CREATE LEDGER RECORD
    =====================================================
    */

    const now =
        new Date();


    const transactionData = {

        transactionId:
            finalTransactionId,

        type,

        orderId,

        paymentId,

        buyerId,

        sellerId:
            sellerId || null,

        listingId:
            listingId || null,

        amount:
            transactionAmount,

        currency,

        commissionRate:
            normalizedCommissionRate,

        commissionAmount:
            normalizedCommission,

        sellerGross:
            normalizedSellerGross,

        sellerNet:
            normalizedSellerNet,

        paymentMethod,

        provider,

        providerTransactionId:
            providerTransactionId ||
            null,

        status,

        metadata,

        createdAt:
            now,

        updatedAt:
            now,

    };


    await transactionRef.set(
        transactionData
    );


    console.log(
        "💰 Transaction created:",
        finalTransactionId
    );


    return {

        success: true,

        alreadyExists: false,

        transactionId:
            finalTransactionId,

        transaction:
            transactionData,

    };

}


/*
=========================================================
CREATE MARKETPLACE SALE TRANSACTION
=========================================================

Convenience function specifically for marketplace sales.

Expected:

amount = buyer payment

commissionAmount = BIASHNET commission

sellerGross = amount - commission

sellerNet = amount seller eventually receives

=========================================================
*/

async function createMarketplaceSaleTransaction({

    orderId,

    paymentId,

    buyerId,

    sellerId,

    listingId,

    amount,

    commissionRate,

    commissionAmount,

    sellerGross,

    sellerNet,

    providerTransactionId,

    paymentMethod =
        PAYMENT_METHODS.MPESA,

    provider =
        PAYMENT_PROVIDERS.MPESA,

    metadata = {},

}) {

    return createTransaction({

        type:
            TRANSACTION_TYPES.MARKETPLACE_SALE,

        orderId,

        paymentId,

        buyerId,

        sellerId,

        listingId,

        amount,

        currency:
            "KES",

        commissionRate,

        commissionAmount,

        sellerGross,

        sellerNet,

        paymentMethod,

        provider,

        providerTransactionId,

        status:
            PAYMENT_STATUS.COMPLETED,

        metadata,

    });

}


/*
=========================================================
CREATE COMMISSION TRANSACTION
=========================================================

Records BIASHNET's commission separately.

Example:

Sale = KES 1,000
Commission = KES 150

This creates:

type:
COMMISSION

amount:
150
=========================================================
*/

async function createCommissionTransaction({

    orderId,

    paymentId,

    buyerId,

    sellerId,

    listingId,

    amount,

    providerTransactionId,

    metadata = {},

}) {

    const commissionAmount =
        toMoney(amount);


    if (
        commissionAmount <= 0
    ) {

        throw new Error(
            "Commission amount must be greater than zero."
        );

    }


    return createTransaction({

        type:
            TRANSACTION_TYPES.COMMISSION,

        orderId,

        paymentId,

        buyerId,

        sellerId,

        listingId,

        amount:
            commissionAmount,

        currency:
            "KES",

        commissionRate:
            0,

        commissionAmount:
            commissionAmount,

        sellerGross:
            0,

        sellerNet:
            0,

        paymentMethod:
            PAYMENT_METHODS.MPESA,

        provider:
            PAYMENT_PROVIDERS.MPESA,

        providerTransactionId,

        status:
            PAYMENT_STATUS.COMPLETED,

        metadata,

    });

}


/*
=========================================================
CREATE SELLER PAYOUT TRANSACTION
=========================================================

This is NOT the actual wallet credit.

It records the financial event when seller funds are
released.

Example:

Seller receives:

KES 850

=========================================================
*/

async function createSellerPayoutTransaction({

    orderId,

    paymentId,

    buyerId,

    sellerId,

    listingId,

    amount,

    providerTransactionId = null,

    metadata = {},

}) {

    const payoutAmount =
        toMoney(amount);


    if (
        payoutAmount <= 0
    ) {

        throw new Error(
            "Seller payout amount must be greater than zero."
        );

    }


    return createTransaction({

        type:
            TRANSACTION_TYPES.SELLER_PAYOUT,

        orderId,

        paymentId,

        buyerId,

        sellerId,

        listingId,

        amount:
            payoutAmount,

        currency:
            "KES",

        commissionRate:
            0,

        commissionAmount:
            0,

        sellerGross:
            payoutAmount,

        sellerNet:
            payoutAmount,

        paymentMethod:
            PAYMENT_METHODS.WALLET,

        provider:
            providerTransactionId
                ? PAYMENT_PROVIDERS.MPESA
                : "BIASHNET_WALLET",

        providerTransactionId,

        status:
            PAYMENT_STATUS.COMPLETED,

        metadata,

    });

}


/*
=========================================================
CREATE REFUND TRANSACTION
=========================================================
*/

async function createRefundTransaction({

    orderId,

    paymentId,

    buyerId,

    sellerId,

    listingId,

    amount,

    providerTransactionId = null,

    metadata = {},

}) {

    const refundAmount =
        toMoney(amount);


    if (
        refundAmount <= 0
    ) {

        throw new Error(
            "Refund amount must be greater than zero."
        );

    }


    return createTransaction({

        type:
            TRANSACTION_TYPES.REFUND,

        orderId,

        paymentId,

        buyerId,

        sellerId,

        listingId,

        amount:
            refundAmount,

        currency:
            "KES",

        commissionRate:
            0,

        commissionAmount:
            0,

        sellerGross:
            0,

        sellerNet:
            0,

        paymentMethod:
            PAYMENT_METHODS.MPESA,

        provider:
            PAYMENT_PROVIDERS.MPESA,

        providerTransactionId,

        status:
            PAYMENT_STATUS.REFUNDED,

        metadata,

    });

}


/*
=========================================================
GET TRANSACTION
=========================================================
*/

async function getTransaction(
    transactionId
) {

    requireValue(
        transactionId,
        "Transaction ID"
    );


    const snap =
        await db
            .collection(
                COLLECTIONS.TRANSACTIONS
            )
            .doc(
                transactionId
            )
            .get();


    if (
        !snap.exists
    ) {

        return null;

    }


    return {

        id:
            snap.id,

        ...snap.data(),

    };

}


/*
=========================================================
GET ORDER TRANSACTIONS
=========================================================
*/

async function getOrderTransactions(
    orderId
) {

    requireValue(
        orderId,
        "Order ID"
    );


    const snapshot =
        await db
            .collection(
                COLLECTIONS.TRANSACTIONS
            )
            .where(
                "orderId",
                "==",
                orderId
            )
            .get();


    return snapshot.docs.map(
        (doc) => ({

            id:
                doc.id,

            ...doc.data(),

        })
    );

}


/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

    createTransaction,

    createMarketplaceSaleTransaction,

    createCommissionTransaction,

    createSellerPayoutTransaction,

    createRefundTransaction,

    getTransaction,

    getOrderTransactions,

};