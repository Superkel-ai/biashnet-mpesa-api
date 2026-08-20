const {
    db
} = require("../config/firebase");

const {
    FieldValue
} = require("firebase-admin/firestore");

const {
    COLLECTIONS
} = require("../config/collections");

const {
    PAYOUT_STATUS,
    TRANSACTION_TYPES,
    MIN_WITHDRAWAL_AMOUNT
} = require("../config/paymentConstants");

const {
    generateWithdrawalId,
    generateTransactionId
} = require("../utils/codeGenerator");


/*
=========================================================
WITHDRAWAL SERVICE
=========================================================

Responsibilities:

1. Validate withdrawal request
2. Verify authenticated seller
3. Read seller wallet
4. Verify available balance
5. Lock withdrawal amount
6. Create withdrawal record
7. Create financial transaction
8. Initiate B2C payout
9. Wait for Safaricom callback
10. Complete or fail withdrawal

IMPORTANT:

This service NEVER trusts balance sent by Android.

The wallet balance is read from Firestore.

Money is stored as numeric KES amounts.

Withdrawal lifecycle:

AVAILABLE
    ↓
LOCKED
    ↓
PROCESSING
    ↓
COMPLETED

OR

LOCKED
    ↓
PROCESSING
    ↓
FAILED
    ↓
UNLOCKED
=========================================================
*/


/*
=========================================================
NORMALIZE PHONE
=========================================================
*/

function normalizePhone(phone) {

    if (!phone) {
        return "";
    }

    let value =
        String(phone)
            .trim()
            .replace(/\s+/g, "")
            .replace(/-/g, "");


    if (
        value.startsWith("+254")
    ) {

        value =
            value.substring(1);

    }


    if (
        value.startsWith("0") &&
        value.length === 10
    ) {

        value =
            "254" +
            value.substring(1);

    }


    return value;

}


/*
=========================================================
VALIDATE PHONE
=========================================================
*/

function validatePhone(phone) {

    return /^2547\d{8}$/.test(
        phone
    );

}


/*
=========================================================
CREATE WITHDRAWAL
=========================================================
*/

async function createWithdrawal({

    userId,

    amount,

    phoneNumber,

}) {

    /*
    =====================================================
    VALIDATION
    =====================================================
    */

    if (!userId) {

        throw new Error(
            "User ID is required."
        );

    }


    const withdrawalAmount =
        Number(amount);


    if (
        !Number.isFinite(
            withdrawalAmount
        ) ||
        withdrawalAmount <= 0
    ) {

        throw new Error(
            "Invalid withdrawal amount."
        );

    }


    if (
        withdrawalAmount <
        MIN_WITHDRAWAL_AMOUNT
    ) {

        throw new Error(
            `Minimum withdrawal amount is KES ${MIN_WITHDRAWAL_AMOUNT}.`
        );

    }


    const phone =
        normalizePhone(
            phoneNumber
        );


    if (!validatePhone(phone)) {

        throw new Error(
            "Invalid Kenyan M-Pesa phone number."
        );

    }


    /*
    =====================================================
    WALLET
    =====================================================
    */

    const walletRef =
        db
            .collection(
                COLLECTIONS.WALLETS
            )
            .doc(userId);


    /*
    =====================================================
    WITHDRAWAL ID
    =====================================================
    */

    const withdrawalId =
        generateWithdrawalId();


    const transactionId =
        generateTransactionId();


    const withdrawalRef =
        db
            .collection(
                COLLECTIONS.WITHDRAWALS
            )
            .doc(
                withdrawalId
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
    ATOMIC WALLET LOCK
    =====================================================

    We use a Firestore transaction.

    This prevents two simultaneous withdrawal
    requests from spending the same balance.
    =====================================================
    */

    await db.runTransaction(
        async (transaction) => {

            const walletSnap =
                await transaction.get(
                    walletRef
                );


            if (!walletSnap.exists) {

                throw new Error(
                    "Seller wallet not found."
                );

            }


            const wallet =
                walletSnap.data();


            const availableBalance =
                Number(
                    wallet.availableBalance ||
                    wallet.balance ||
                    0
                );


            const lockedBalance =
                Number(
                    wallet.lockedBalance ||
                    0
                );


            if (
                availableBalance <
                withdrawalAmount
            ) {

                throw new Error(
                    "Insufficient available wallet balance."
                );

            }


            /*
            -------------------------------------------------
            MOVE MONEY FROM AVAILABLE → LOCKED
            -------------------------------------------------
            */

            transaction.update(
                walletRef,
                {

                    availableBalance:
                        Number(
                            (
                                availableBalance -
                                withdrawalAmount
                            ).toFixed(2)
                        ),

                    lockedBalance:
                        Number(
                            (
                                lockedBalance +
                                withdrawalAmount
                            ).toFixed(2)
                        ),

                    updatedAt:
                        now,

                }
            );


            /*
            -------------------------------------------------
            WITHDRAWAL RECORD
            -------------------------------------------------
            */

            transaction.set(
                withdrawalRef,
                {

                    withdrawalId,

                    transactionId,

                    userId,

                    amount:
                        withdrawalAmount,

                    currency:
                        "KES",

                    phone,

                    provider:
                        "MPESA",

                    status:
                        PAYOUT_STATUS.PENDING,

                    payoutStatus:
                        PAYOUT_STATUS.PENDING,

                    locked:
                        true,

                    createdAt:
                        now,

                    updatedAt:
                        now,

                }
            );


            /*
            -------------------------------------------------
            FINANCIAL LEDGER
            -------------------------------------------------
            */

            transaction.set(
                transactionRef,
                {

                    transactionId,

                    type:
                        TRANSACTION_TYPES.WALLET_WITHDRAWAL,

                    userId,

                    withdrawalId,

                    amount:
                        withdrawalAmount,

                    currency:
                        "KES",

                    paymentMethod:
                        "MPESA",

                    provider:
                        "MPESA",

                    status:
                        PAYOUT_STATUS.PENDING,

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

        withdrawalId,

        transactionId,

        amount:
            withdrawalAmount,

        currency:
            "KES",

        phone,

        status:
            PAYOUT_STATUS.PENDING,

        message:
            "Withdrawal request created successfully. Your funds are locked pending processing.",

    };

}


/*
=========================================================
MARK WITHDRAWAL PROCESSING
=========================================================

Called when the B2C payout is actually sent to
Safaricom.
=========================================================
*/

async function markWithdrawalProcessing({

    withdrawalId,

    conversationId = null,

    originatorConversationId = null,

}) {

    if (!withdrawalId) {

        throw new Error(
            "Withdrawal ID is required."
        );

    }


    const withdrawalRef =
        db
            .collection(
                COLLECTIONS.WITHDRAWALS
            )
            .doc(
                withdrawalId
            );


    const snap =
        await withdrawalRef.get();


    if (!snap.exists) {

        throw new Error(
            "Withdrawal not found."
        );

    }


    const withdrawal =
        snap.data();


    if (
        withdrawal.status ===
        PAYOUT_STATUS.COMPLETED
    ) {

        return {

            success: true,

            alreadyCompleted: true,

        };

    }


    await withdrawalRef.update({

        status:
            PAYOUT_STATUS.PROCESSING,

        payoutStatus:
            PAYOUT_STATUS.PROCESSING,

        conversationId,

        originatorConversationId,

        processingAt:
            new Date(),

        updatedAt:
            new Date(),

    });


    return {

        success: true,

        withdrawalId,

        status:
            PAYOUT_STATUS.PROCESSING,

    };

}


/*
=========================================================
COMPLETE WITHDRAWAL
=========================================================

Called after successful Safaricom B2C callback.

Important:

The money is already locked.

Completion therefore removes the locked amount.

It must NOT deduct availableBalance again.
=========================================================
*/

async function completeWithdrawal({

    withdrawalId,

    transactionId = null,

    mpesaReceiptNumber = null,

    providerResponse = null,

}) {

    if (!withdrawalId) {

        throw new Error(
            "Withdrawal ID is required."
        );

    }


    const withdrawalRef =
        db
            .collection(
                COLLECTIONS.WITHDRAWALS
            )
            .doc(
                withdrawalId
            );


    await db.runTransaction(
        async (transaction) => {

            const withdrawalSnap =
                await transaction.get(
                    withdrawalRef
                );


            if (
                !withdrawalSnap.exists
            ) {

                throw new Error(
                    "Withdrawal not found."
                );

            }


            const withdrawal =
                withdrawalSnap.data();


            /*
            -------------------------------------------------
            IDEMPOTENCY
            -------------------------------------------------
            */

            if (
                withdrawal.status ===
                PAYOUT_STATUS.COMPLETED
            ) {

                return;

            }


            const walletRef =
                db
                    .collection(
                        COLLECTIONS.WALLETS
                    )
                    .doc(
                        withdrawal.userId
                    );


            const walletSnap =
                await transaction.get(
                    walletRef
                );


            if (!walletSnap.exists) {

                throw new Error(
                    "Seller wallet not found."
                );

            }


            const wallet =
                walletSnap.data();


            const lockedBalance =
                Number(
                    wallet.lockedBalance ||
                    0
                );


            const amount =
                Number(
                    withdrawal.amount
                );


            /*
            -------------------------------------------------
            REMOVE FROM LOCKED BALANCE
            -------------------------------------------------
            */

            transaction.update(
                walletRef,
                {

                    lockedBalance:
                        Math.max(
                            0,
                            Number(
                                (
                                    lockedBalance -
                                    amount
                                ).toFixed(2)
                            )
                        ),

                    updatedAt:
                        new Date(),

                }
            );


            /*
            -------------------------------------------------
            UPDATE WITHDRAWAL
            -------------------------------------------------
            */

            transaction.update(
                withdrawalRef,
                {

                    status:
                        PAYOUT_STATUS.COMPLETED,

                    payoutStatus:
                        PAYOUT_STATUS.COMPLETED,

                    mpesaReceiptNumber,

                    providerTransactionId:
                        transactionId,

                    providerResponse:
                        providerResponse ||
                        null,

                    completedAt:
                        new Date(),

                    updatedAt:
                        new Date(),

                }
            );

        }
    );


    return {

        success: true,

        withdrawalId,

        status:
            PAYOUT_STATUS.COMPLETED,

        mpesaReceiptNumber,

    };

}


/*
=========================================================
FAIL WITHDRAWAL
=========================================================

Called when Safaricom rejects/fails the B2C payout.

The locked money is returned to availableBalance.
=========================================================
*/

async function failWithdrawal({

    withdrawalId,

    reason = "Withdrawal failed.",

    providerResponse = null,

}) {

    if (!withdrawalId) {

        throw new Error(
            "Withdrawal ID is required."
        );

    }


    const withdrawalRef =
        db
            .collection(
                COLLECTIONS.WITHDRAWALS
            )
            .doc(
                withdrawalId
            );


    await db.runTransaction(
        async (transaction) => {

            const withdrawalSnap =
                await transaction.get(
                    withdrawalRef
                );


            if (
                !withdrawalSnap.exists
            ) {

                throw new Error(
                    "Withdrawal not found."
                );

            }


            const withdrawal =
                withdrawalSnap.data();


            /*
            -------------------------------------------------
            IDEMPOTENCY
            -------------------------------------------------
            */

            if (
                withdrawal.status ===
                    PAYOUT_STATUS.FAILED ||
                withdrawal.status ===
                    PAYOUT_STATUS.COMPLETED
            ) {

                return;

            }


            const walletRef =
                db
                    .collection(
                        COLLECTIONS.WALLETS
                    )
                    .doc(
                        withdrawal.userId
                    );


            const walletSnap =
                await transaction.get(
                    walletRef
                );


            if (!walletSnap.exists) {

                throw new Error(
                    "Seller wallet not found."
                );

            }


            const wallet =
                walletSnap.data();


            const availableBalance =
                Number(
                    wallet.availableBalance ||
                    wallet.balance ||
                    0
                );


            const lockedBalance =
                Number(
                    wallet.lockedBalance ||
                    0
                );


            const amount =
                Number(
                    withdrawal.amount
                );


            /*
            -------------------------------------------------
            UNLOCK MONEY
            -------------------------------------------------
            */

            transaction.update(
                walletRef,
                {

                    availableBalance:
                        Number(
                            (
                                availableBalance +
                                amount
                            ).toFixed(2)
                        ),

                    lockedBalance:
                        Math.max(
                            0,
                            Number(
                                (
                                    lockedBalance -
                                    amount
                                ).toFixed(2)
                            )
                        ),

                    updatedAt:
                        new Date(),

                }
            );


            /*
            -------------------------------------------------
            UPDATE WITHDRAWAL
            -------------------------------------------------
            */

            transaction.update(
                withdrawalRef,
                {

                    status:
                        PAYOUT_STATUS.FAILED,

                    payoutStatus:
                        PAYOUT_STATUS.FAILED,

                    failureReason:
                        reason,

                    providerResponse:
                        providerResponse ||
                        null,

                    failedAt:
                        new Date(),

                    updatedAt:
                        new Date(),

                }
            );

        }
    );


    return {

        success: true,

        withdrawalId,

        status:
            PAYOUT_STATUS.FAILED,

        message:
            reason,

    };

}


/*
=========================================================
GET WITHDRAWAL
=========================================================
*/

async function getWithdrawal(
    withdrawalId
) {

    if (!withdrawalId) {

        throw new Error(
            "Withdrawal ID is required."
        );

    }


    const snap =
        await db
            .collection(
                COLLECTIONS.WITHDRAWALS
            )
            .doc(
                withdrawalId
            )
            .get();


    if (!snap.exists) {

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
GET USER WITHDRAWALS
=========================================================
*/

async function getUserWithdrawals(
    userId
) {

    if (!userId) {

        throw new Error(
            "User ID is required."
        );

    }


    const snap =
        await db
            .collection(
                COLLECTIONS.WITHDRAWALS
            )
            .where(
                "userId",
                "==",
                userId
            )
            .orderBy(
                "createdAt",
                "desc"
            )
            .get();


    return snap.docs.map(
        (doc) => ({

            id:
                doc.id,

            ...doc.data(),

        })
    );

}


/*
=========================================================
EXPORT
=========================================================
*/

module.exports = {

    createWithdrawal,

    markWithdrawalProcessing,

    completeWithdrawal,

    failWithdrawal,

    getWithdrawal,

    getUserWithdrawals,

};