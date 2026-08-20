const {
    db,
    FieldValue
} = require("../config/firebase");

const {
    COLLECTIONS
} = require("../config/collections");

const {
    TRANSACTION_TYPES
} = require("../config/paymentConstants");

const {
    generateTransactionId
} = require("../utils/codeGenerator");


/*
=========================================================
BIASHNET WALLET SERVICE
=========================================================

PURPOSE
---------------------------------------------------------

Manages seller marketplace wallet balances.

IMPORTANT:

This service does NOT:

- initiate M-PESA
- process STK Push
- verify Firebase authentication
- calculate marketplace commission
- decide whether an order is completed
- generate completion codes
- directly perform M-PESA withdrawals

It manages wallet money.

---------------------------------------------------------

WALLET MODEL
---------------------------------------------------------

availableBalance
    Money seller can withdraw/use.

heldBalance
    Seller money earned from paid orders but not yet
    released because delivery has not been confirmed.

withdrawalBalance
    Money currently locked for an active withdrawal.

totalEarned
    Lifetime amount released to seller.

totalWithdrawn
    Lifetime amount successfully withdrawn.

---------------------------------------------------------

IMPORTANT:

Buyer payment:

KES 1,000
     ↓
Seller's KES 850
     ↓
HELD

After completion code:

HELD KES 850
     ↓
AVAILABLE KES 850

After withdrawal:

AVAILABLE KES 850
     ↓
WITHDRAWAL LOCK
     ↓
SUCCESS
     ↓
WITHDRAWN

=========================================================
*/


/*
=========================================================
WALLET DEFAULT STRUCTURE
=========================================================
*/

function defaultWallet(userId) {

    return {

        userId,

        currency:
            "KES",

        availableBalance:
            0,

        heldBalance:
            0,

        withdrawalBalance:
            0,

        totalEarned:
            0,

        totalWithdrawn:
            0,

        createdAt:
            new Date(),

        updatedAt:
            new Date(),

    };

}


/*
=========================================================
MONEY HELPER
=========================================================
*/

function toMoney(value) {

    const amount =
        Number(value);


    if (
        !Number.isFinite(amount)
    ) {

        throw new Error(
            "Invalid wallet amount."
        );

    }


    return Number(
        amount.toFixed(2)
    );

}


/*
=========================================================
VALIDATE POSITIVE AMOUNT
=========================================================
*/

function validateAmount(
    amount,
    field = "Amount"
) {

    const value =
        toMoney(amount);


    if (
        value <= 0
    ) {

        throw new Error(
            `${field} must be greater than zero.`
        );

    }


    return value;

}


/*
=========================================================
GET WALLET
=========================================================
*/

async function getWallet(
    userId
) {

    if (!userId) {

        throw new Error(
            "User ID is required."
        );

    }


    const walletRef =
        db
            .collection(
                COLLECTIONS.WALLETS
            )
            .doc(
                userId
            );


    const walletSnap =
        await walletRef.get();


    if (
        !walletSnap.exists
    ) {

        return null;

    }


    return {

        id:
            walletSnap.id,

        ...walletSnap.data(),

    };

}


/*
=========================================================
CREATE WALLET IF IT DOES NOT EXIST
=========================================================
*/

async function createWalletIfNotExists(
    userId
) {

    if (!userId) {

        throw new Error(
            "User ID is required."
        );

    }


    const walletRef =
        db
            .collection(
                COLLECTIONS.WALLETS
            )
            .doc(
                userId
            );


    const walletSnap =
        await walletRef.get();


    if (
        walletSnap.exists
    ) {

        return {

            created: false,

            wallet: {

                id:
                    walletSnap.id,

                ...walletSnap.data(),

            },

        };

    }


    const wallet =
        defaultWallet(
            userId
        );


    await walletRef.create(
        wallet
    );


    return {

        created: true,

        wallet: {

            id:
                userId,

            ...wallet,

        },

    };

}


/*
=========================================================
HOLD SELLER FUNDS
=========================================================

Called after successful marketplace payment.

Example:

Order:

KES 1,000

Commission:

KES 150

Seller:

KES 850

The KES 850 is NOT available yet.

It becomes:

heldBalance = 850

---------------------------------------------------------

This is called by settlementService.

=========================================================
*/

async function holdSellerFunds({

    sellerId,

    amount,

    orderId,

    paymentId,

    transactionId = null,

}) {

    if (!sellerId) {

        throw new Error(
            "Seller ID is required."
        );

    }


    const heldAmount =
        validateAmount(
            amount,
            "Held amount"
        );


    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }


    if (!paymentId) {

        throw new Error(
            "Payment ID is required."
        );

    }


    const walletRef =
        db
            .collection(
                COLLECTIONS.WALLETS
            )
            .doc(
                sellerId
            );


    const finalTransactionId =
        transactionId ||
        generateTransactionId();


    const now =
        new Date();


    /*
    =====================================================
    ATOMIC WALLET UPDATE
    =====================================================
    */

    await db.runTransaction(
        async (transaction) => {

            const walletSnap =
                await transaction.get(
                    walletRef
                );


            let wallet;


            if (
                walletSnap.exists
            ) {

                wallet =
                    walletSnap.data();

            } else {

                wallet =
                    defaultWallet(
                        sellerId
                    );

            }


            const currentHeld =
                toMoney(
                    wallet.heldBalance || 0
                );


            const newHeld =
                toMoney(
                    currentHeld +
                    heldAmount
                );


            if (
                walletSnap.exists
            ) {

                transaction.update(
                    walletRef,
                    {

                        heldBalance:
                            newHeld,

                        updatedAt:
                            now,

                    }
                );

            } else {

                transaction.set(
                    walletRef,
                    {

                        ...wallet,

                        heldBalance:
                            newHeld,

                    }
                );

            }

        }
    );


    console.log(
        "🔒 Seller funds held:",
        sellerId,
        heldAmount
    );


    return {

        success: true,

        sellerId,

        orderId,

        paymentId,

        transactionId:
            finalTransactionId,

        amount:
            heldAmount,

        status:
            "HELD",

    };

}


/*
=========================================================
RELEASE HELD SELLER FUNDS
=========================================================

Called AFTER successful completion-code verification.

Example:

heldBalance = 850

After release:

heldBalance = 0
availableBalance = 850

=========================================================
*/

async function releaseHeldFunds({

    sellerId,

    amount,

    orderId,

    paymentId,

    transactionId = null,

}) {

    if (!sellerId) {

        throw new Error(
            "Seller ID is required."
        );

    }


    const releaseAmount =
        validateAmount(
            amount,
            "Release amount"
        );


    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }


    const walletRef =
        db
            .collection(
                COLLECTIONS.WALLETS
            )
            .doc(
                sellerId
            );


    const finalTransactionId =
        transactionId ||
        generateTransactionId();


    const now =
        new Date();


    await db.runTransaction(
        async (transaction) => {

            const walletSnap =
                await transaction.get(
                    walletRef
                );


            if (
                !walletSnap.exists
            ) {

                throw new Error(
                    "Seller wallet does not exist."
                );

            }


            const wallet =
                walletSnap.data();


            const heldBalance =
                toMoney(
                    wallet.heldBalance || 0
                );


            if (
                heldBalance <
                releaseAmount
            ) {

                throw new Error(
                    "Insufficient held balance."
                );

            }


            const availableBalance =
                toMoney(
                    wallet.availableBalance || 0
                );


            const totalEarned =
                toMoney(
                    wallet.totalEarned || 0
                );


            transaction.update(
                walletRef,
                {

                    heldBalance:
                        toMoney(
                            heldBalance -
                            releaseAmount
                        ),

                    availableBalance:
                        toMoney(
                            availableBalance +
                            releaseAmount
                        ),

                    totalEarned:
                        toMoney(
                            totalEarned +
                            releaseAmount
                        ),

                    updatedAt:
                        now,

                }
            );

        }
    );


    console.log(
        "🔓 Seller funds released:",
        sellerId,
        releaseAmount
    );


    return {

        success: true,

        sellerId,

        orderId,

        paymentId,

        transactionId:
            finalTransactionId,

        amount:
            releaseAmount,

        status:
            "RELEASED",

    };

}


/*
=========================================================
LOCK FUNDS FOR WITHDRAWAL
=========================================================

Seller requests withdrawal.

Example:

availableBalance = 850

Seller requests:

500

Result:

availableBalance = 350
withdrawalBalance = 500

The money is temporarily locked while M-PESA withdrawal
is being processed.

=========================================================
*/

async function lockWithdrawalFunds({

    sellerId,

    amount,

    withdrawalId,

}) {

    if (!sellerId) {

        throw new Error(
            "Seller ID is required."
        );

    }


    const withdrawalAmount =
        validateAmount(
            amount,
            "Withdrawal amount"
        );


    if (!withdrawalId) {

        throw new Error(
            "Withdrawal ID is required."
        );

    }


    const walletRef =
        db
            .collection(
                COLLECTIONS.WALLETS
            )
            .doc(
                sellerId
            );


    const now =
        new Date();


    await db.runTransaction(
        async (transaction) => {

            const walletSnap =
                await transaction.get(
                    walletRef
                );


            if (
                !walletSnap.exists
            ) {

                throw new Error(
                    "Seller wallet does not exist."
                );

            }


            const wallet =
                walletSnap.data();


            const availableBalance =
                toMoney(
                    wallet.availableBalance || 0
                );


            if (
                availableBalance <
                withdrawalAmount
            ) {

                throw new Error(
                    "Insufficient available wallet balance."
                );

            }


            const currentWithdrawalBalance =
                toMoney(
                    wallet.withdrawalBalance || 0
                );


            transaction.update(
                walletRef,
                {

                    availableBalance:
                        toMoney(
                            availableBalance -
                            withdrawalAmount
                        ),

                    withdrawalBalance:
                        toMoney(
                            currentWithdrawalBalance +
                            withdrawalAmount
                        ),

                    updatedAt:
                        now,

                }
            );

        }
    );


    return {

        success: true,

        sellerId,

        withdrawalId,

        amount:
            withdrawalAmount,

        status:
            "LOCKED",

    };

}


/*
=========================================================
COMPLETE WITHDRAWAL
=========================================================

Called after successful M-PESA B2C withdrawal.

Example:

withdrawalBalance = 500

After success:

withdrawalBalance = 0
totalWithdrawn += 500

=========================================================
*/

async function completeWithdrawal({

    sellerId,

    amount,

    withdrawalId,

}) {

    if (!sellerId) {

        throw new Error(
            "Seller ID is required."
        );

    }


    const withdrawalAmount =
        validateAmount(
            amount,
            "Withdrawal amount"
        );


    if (!withdrawalId) {

        throw new Error(
            "Withdrawal ID is required."
        );

    }


    const walletRef =
        db
            .collection(
                COLLECTIONS.WALLETS
            )
            .doc(
                sellerId
            );


    const now =
        new Date();


    await db.runTransaction(
        async (transaction) => {

            const walletSnap =
                await transaction.get(
                    walletRef
                );


            if (
                !walletSnap.exists
            ) {

                throw new Error(
                    "Seller wallet does not exist."
                );

            }


            const wallet =
                walletSnap.data();


            const locked =
                toMoney(
                    wallet.withdrawalBalance || 0
                );


            if (
                locked <
                withdrawalAmount
            ) {

                throw new Error(
                    "Withdrawal balance is insufficient."
                );

            }


            const totalWithdrawn =
                toMoney(
                    wallet.totalWithdrawn || 0
                );


            transaction.update(
                walletRef,
                {

                    withdrawalBalance:
                        toMoney(
                            locked -
                            withdrawalAmount
                        ),

                    totalWithdrawn:
                        toMoney(
                            totalWithdrawn +
                            withdrawalAmount
                        ),

                    updatedAt:
                        now,

                }
            );

        }
    );


    return {

        success: true,

        sellerId,

        withdrawalId,

        amount:
            withdrawalAmount,

        status:
            "COMPLETED",

    };

}


/*
=========================================================
RESTORE FAILED WITHDRAWAL
=========================================================

If M-PESA B2C withdrawal fails:

withdrawalBalance
       ↓
availableBalance

Example:

withdrawalBalance = 500
availableBalance = 350

After failure:

withdrawalBalance = 0
availableBalance = 850

=========================================================
*/

async function restoreFailedWithdrawal({

    sellerId,

    amount,

    withdrawalId,

}) {

    if (!sellerId) {

        throw new Error(
            "Seller ID is required."
        );

    }


    const withdrawalAmount =
        validateAmount(
            amount,
            "Withdrawal amount"
        );


    if (!withdrawalId) {

        throw new Error(
            "Withdrawal ID is required."
        );

    }


    const walletRef =
        db
            .collection(
                COLLECTIONS.WALLETS
            )
            .doc(
                sellerId
            );


    const now =
        new Date();


    await db.runTransaction(
        async (transaction) => {

            const walletSnap =
                await transaction.get(
                    walletRef
                );


            if (
                !walletSnap.exists
            ) {

                throw new Error(
                    "Seller wallet does not exist."
                );

            }


            const wallet =
                walletSnap.data();


            const withdrawalBalance =
                toMoney(
                    wallet.withdrawalBalance || 0
                );


            if (
                withdrawalBalance <
                withdrawalAmount
            ) {

                throw new Error(
                    "Withdrawal balance is insufficient."
                );

            }


            const availableBalance =
                toMoney(
                    wallet.availableBalance || 0
                );


            transaction.update(
                walletRef,
                {

                    withdrawalBalance:
                        toMoney(
                            withdrawalBalance -
                            withdrawalAmount
                        ),

                    availableBalance:
                        toMoney(
                            availableBalance +
                            withdrawalAmount
                        ),

                    updatedAt:
                        now,

                }
            );

        }
    );


    return {

        success: true,

        sellerId,

        withdrawalId,

        amount:
            withdrawalAmount,

        status:
            "RESTORED",

    };

}


/*
=========================================================
GET AVAILABLE BALANCE
=========================================================
*/

async function getAvailableBalance(
    sellerId
) {

    const wallet =
        await getWallet(
            sellerId
        );


    if (!wallet) {

        return 0;

    }


    return toMoney(
        wallet.availableBalance || 0
    );

}

/*
=========================================================
GET SELLER WALLET SUMMARY
=========================================================
*/

async function getWalletSummary(
    sellerId
) {

    const wallet =
        await getWallet(
            sellerId
        );


    if (!wallet) {

        return {

            exists: false,

            userId:
                sellerId,

            currency:
                "KES",

            availableBalance:
                0,

            heldBalance:
                0,

            withdrawalBalance:
                0,

            totalEarned:
                0,

            totalWithdrawn:
                0,

        };

    }


    return {

        exists: true,

        userId:
            sellerId,

        currency:
            wallet.currency ||
            "KES",

        availableBalance:
            toMoney(
                wallet.availableBalance || 0
            ),

        heldBalance:
            toMoney(
                wallet.heldBalance || 0
            ),

        withdrawalBalance:
            toMoney(
                wallet.withdrawalBalance || 0
            ),

        totalEarned:
            toMoney(
                wallet.totalEarned || 0
            ),

        totalWithdrawn:
            toMoney(
                wallet.totalWithdrawn || 0
            ),

    };

}


/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

    getWallet,

    createWalletIfNotExists,

    holdSellerFunds,

    releaseHeldFunds,

    lockWithdrawalFunds,

    completeWithdrawal,

    restoreFailedWithdrawal,

    getAvailableBalance,

    getWalletSummary,

};
