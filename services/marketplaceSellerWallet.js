const { db } = require("../config/firebase");

/*
=========================================================
MARKETPLACE SELLER WALLET SERVICE
=========================================================

Collections used:

marketplaceWallets
marketplaceLedger

IMPORTANT:
This service NEVER touches:

wallets
transactions
investor
investmentStats
=========================================================
*/


/*
=========================================================
GET / CREATE SELLER WALLET
=========================================================
*/

async function getOrCreateSellerWallet(userId) {

    if (!userId) {
        throw new Error("Seller userId is required");
    }

    const walletRef =
        db.collection("marketplaceWallets")
          .doc(userId);

    const walletSnap =
        await walletRef.get();

    if (walletSnap.exists) {

        return {
            id: walletSnap.id,
            ...walletSnap.data()
        };

    }

    const wallet = {

        userId,

        availableBalance: 0,

        pendingBalance: 0,

        lockedBalance: 0,

        totalSales: 0,

        totalEarnings: 0,

        totalCommission: 0,

        totalWithdrawn: 0,

        totalWithdrawalFees: 0,

        currency: "KES",

        status: "active",

        createdAt: new Date(),

        updatedAt: new Date(),

    };


    await walletRef.set(wallet);


    return {

        id: walletRef.id,

        ...wallet

    };

}


/*
=========================================================
ADD PENDING SELLER EARNINGS
=========================================================

Called after successful buyer payment.

Example:

Product = 5,000
Commission = 750
Seller = 4,250

The 4,250 goes into:

pendingBalance

NOT availableBalance.

Seller cannot withdraw it yet.
=========================================================
*/

async function addPendingEarnings({

    sellerId,

    orderId,

    amount,

    grossAmount,

    commissionAmount,

}) {

    if (!sellerId) {
        throw new Error("Seller ID is required");
    }

    const sellerAmount =
        Number(amount);

    const gross =
        Number(grossAmount || 0);

    const commission =
        Number(commissionAmount || 0);


    if (
        !Number.isFinite(sellerAmount) ||
        sellerAmount <= 0
    ) {
        throw new Error("Invalid seller earnings amount");
    }


    if (!orderId) {
        throw new Error("Order ID is required");
    }


    const walletRef =
        db.collection("marketplaceWallets")
          .doc(sellerId);

    const ledgerRef =
        db.collection("marketplaceLedger")
          .doc(
              `PENDING-${orderId}`
          );


    await db.runTransaction(
        async (transaction) => {

            const walletSnap =
                await transaction.get(
                    walletRef
                );


            const wallet =
                walletSnap.exists
                    ? walletSnap.data()
                    : {

                        userId: sellerId,

                        availableBalance: 0,

                        pendingBalance: 0,

                        lockedBalance: 0,

                        totalSales: 0,

                        totalEarnings: 0,

                        totalCommission: 0,

                        totalWithdrawn: 0,

                        totalWithdrawalFees: 0,

                    };


            /*
            -----------------------------------------
            IDEMPOTENCY
            -----------------------------------------
            */

            const ledgerSnap =
                await transaction.get(
                    ledgerRef
                );


            if (ledgerSnap.exists) {

                return;

            }


            /*
            -----------------------------------------
            UPDATE WALLET
            -----------------------------------------
            */

            transaction.set(

                walletRef,

                {

                    userId: sellerId,

                    pendingBalance:
                        Number(
                            wallet.pendingBalance || 0
                        ) + sellerAmount,

                    totalSales:
                        Number(
                            wallet.totalSales || 0
                        ) + gross,

                    totalEarnings:
                        Number(
                            wallet.totalEarnings || 0
                        ) + sellerAmount,

                    totalCommission:
                        Number(
                            wallet.totalCommission || 0
                        ) + commission,

                    updatedAt:
                        new Date(),

                },

                {
                    merge: true
                }

            );


            /*
            -----------------------------------------
            LEDGER
            -----------------------------------------
            */

            transaction.set(

                ledgerRef,

                {

                    ledgerId:
                        ledgerRef.id,

                    userId:
                        sellerId,

                    orderId,

                    type:
                        "SELLER_EARNINGS_PENDING",

                    amount:
                        sellerAmount,

                    grossAmount:
                        gross,

                    commissionAmount:
                        commission,

                    status:
                        "PENDING",

                    createdAt:
                        new Date(),

                }

            );

        }
    );


    return {

        success: true,

        sellerId,

        orderId,

        amount:
            sellerAmount,

        status:
            "PENDING",

    };

}


/*
=========================================================
RELEASE PENDING EARNINGS
=========================================================

Called ONLY after:

Buyer paid
      ↓
Product delivered
      ↓
Delivery code verified
      ↓
Order COMPLETED

pendingBalance → availableBalance
=========================================================
*/

async function releaseSellerEarnings({

    sellerId,

    orderId,

    amount,

}) {

    if (!sellerId) {
        throw new Error("Seller ID is required");
    }

    if (!orderId) {
        throw new Error("Order ID is required");
    }

    const releaseAmount =
        Number(amount);


    if (
        !Number.isFinite(releaseAmount) ||
        releaseAmount <= 0
    ) {
        throw new Error("Invalid release amount");
    }


    const walletRef =
        db.collection("marketplaceWallets")
          .doc(sellerId);

    const ledgerRef =
        db.collection("marketplaceLedger")
          .doc(
              `RELEASE-${orderId}`
          );


    await db.runTransaction(
        async (transaction) => {

            const walletSnap =
                await transaction.get(
                    walletRef
                );


            if (!walletSnap.exists) {

                throw new Error(
                    "Seller marketplace wallet not found"
                );

            }


            const wallet =
                walletSnap.data();


            /*
            -----------------------------------------
            IDEMPOTENCY
            -----------------------------------------
            */

            const releaseSnap =
                await transaction.get(
                    ledgerRef
                );


            if (releaseSnap.exists) {

                return;

            }


            const pending =
                Number(
                    wallet.pendingBalance || 0
                );


            if (pending < releaseAmount) {

                throw new Error(
                    "Insufficient pending seller balance"
                );

            }


            const available =
                Number(
                    wallet.availableBalance || 0
                );


            /*
            -----------------------------------------
            MOVE MONEY
            -----------------------------------------
            */

            transaction.update(

                walletRef,

                {

                    pendingBalance:
                        pending -
                        releaseAmount,

                    availableBalance:
                        available +
                        releaseAmount,

                    updatedAt:
                        new Date(),

                }

            );


            /*
            -----------------------------------------
            LEDGER
            -----------------------------------------
            */

            transaction.set(

                ledgerRef,

                {

                    ledgerId:
                        ledgerRef.id,

                    userId:
                        sellerId,

                    orderId,

                    type:
                        "SELLER_EARNINGS_RELEASED",

                    amount:
                        releaseAmount,

                    from:
                        "PENDING",

                    to:
                        "AVAILABLE",

                    status:
                        "COMPLETED",

                    createdAt:
                        new Date(),

                }

            );

        }
    );


    return {

        success: true,

        sellerId,

        orderId,

        amount:
            releaseAmount,

        status:
            "AVAILABLE",

    };

}


/*
=========================================================
LOCK MONEY FOR WITHDRAWAL
=========================================================

availableBalance → lockedBalance
=========================================================
*/

async function lockWithdrawalFunds({

    sellerId,

    withdrawalId,

    amount,

}) {

    const withdrawalAmount =
        Number(amount);


    if (!sellerId) {
        throw new Error("Seller ID is required");
    }

    if (!withdrawalId) {
        throw new Error(
            "Withdrawal ID is required"
        );
    }

    if (
        !Number.isFinite(withdrawalAmount) ||
        withdrawalAmount <= 0
    ) {
        throw new Error(
            "Invalid withdrawal amount"
        );
    }


    const walletRef =
        db.collection("marketplaceWallets")
          .doc(sellerId);

    const ledgerRef =
        db.collection("marketplaceLedger")
          .doc(
              `WITHDRAWAL-LOCK-${withdrawalId}`
          );


    await db.runTransaction(
        async (transaction) => {

            const walletSnap =
                await transaction.get(
                    walletRef
                );


            if (!walletSnap.exists) {

                throw new Error(
                    "Seller wallet not found"
                );

            }


            const wallet =
                walletSnap.data();


            const ledgerSnap =
                await transaction.get(
                    ledgerRef
                );


            if (ledgerSnap.exists) {

                return;

            }


            const available =
                Number(
                    wallet.availableBalance || 0
                );


            if (
                available <
                withdrawalAmount
            ) {

                throw new Error(
                    "Insufficient available balance"
                );

            }


            const locked =
                Number(
                    wallet.lockedBalance || 0
                );


            transaction.update(

                walletRef,

                {

                    availableBalance:
                        available -
                        withdrawalAmount,

                    lockedBalance:
                        locked +
                        withdrawalAmount,

                    updatedAt:
                        new Date(),

                }

            );


            transaction.set(

                ledgerRef,

                {

                    ledgerId:
                        ledgerRef.id,

                    userId:
                        sellerId,

                    withdrawalId,

                    type:
                        "WITHDRAWAL_LOCK",

                    amount:
                        withdrawalAmount,

                    status:
                        "LOCKED",

                    createdAt:
                        new Date(),

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

Called after successful M-PESA B2C.

lockedBalance decreases.
totalWithdrawn increases.
=========================================================
*/

async function completeWithdrawal({

    sellerId,

    withdrawalId,

    amount,

    fee = 0,

}) {

    const withdrawalAmount =
        Number(amount);

    const withdrawalFee =
        Number(fee || 0);


    if (!sellerId) {
        throw new Error("Seller ID is required");
    }

    if (!withdrawalId) {
        throw new Error(
            "Withdrawal ID is required"
        );
    }

    if (
        !Number.isFinite(withdrawalAmount) ||
        withdrawalAmount <= 0
    ) {
        throw new Error(
            "Invalid withdrawal amount"
        );
    }


    const walletRef =
        db.collection("marketplaceWallets")
          .doc(sellerId);

    const ledgerRef =
        db.collection("marketplaceLedger")
          .doc(
              `WITHDRAWAL-COMPLETE-${withdrawalId}`
          );


    await db.runTransaction(
        async (transaction) => {

            const walletSnap =
                await transaction.get(
                    walletRef
                );


            if (!walletSnap.exists) {

                throw new Error(
                    "Seller wallet not found"
                );

            }


            const wallet =
                walletSnap.data();


            const ledgerSnap =
                await transaction.get(
                    ledgerRef
                );


            if (ledgerSnap.exists) {

                return;

            }


            const locked =
                Number(
                    wallet.lockedBalance || 0
                );


            if (
                locked <
                withdrawalAmount
            ) {

                throw new Error(
                    "Locked withdrawal balance is insufficient"
                );

            }


            transaction.update(

                walletRef,

                {

                    lockedBalance:
                        locked -
                        withdrawalAmount,

                    totalWithdrawn:
                        Number(
                            wallet.totalWithdrawn || 0
                        ) +
                        withdrawalAmount,

                    totalWithdrawalFees:
                        Number(
                            wallet.totalWithdrawalFees || 0
                        ) +
                        withdrawalFee,

                    updatedAt:
                        new Date(),

                }

            );


            transaction.set(

                ledgerRef,

                {

                    ledgerId:
                        ledgerRef.id,

                    userId:
                        sellerId,

                    withdrawalId,

                    type:
                        "WITHDRAWAL_COMPLETED",

                    amount:
                        withdrawalAmount,

                    fee:
                        withdrawalFee,

                    status:
                        "COMPLETED",

                    createdAt:
                        new Date(),

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

        fee:
            withdrawalFee,

        status:
            "COMPLETED",

    };

}


/*
=========================================================
REVERSE FAILED WITHDRAWAL
=========================================================

If M-PESA B2C fails:

lockedBalance → availableBalance
=========================================================
*/

async function reverseWithdrawal({

    sellerId,

    withdrawalId,

    amount,

    reason = "Withdrawal failed",

}) {

    const withdrawalAmount =
        Number(amount);


    if (!sellerId) {
        throw new Error("Seller ID is required");
    }

    if (!withdrawalId) {
        throw new Error(
            "Withdrawal ID is required"
        );
    }


    const walletRef =
        db.collection("marketplaceWallets")
          .doc(sellerId);

    const ledgerRef =
        db.collection("marketplaceLedger")
          .doc(
              `WITHDRAWAL-REVERSE-${withdrawalId}`
          );


    await db.runTransaction(
        async (transaction) => {

            const walletSnap =
                await transaction.get(
                    walletRef
                );


            if (!walletSnap.exists) {

                throw new Error(
                    "Seller wallet not found"
                );

            }


            const wallet =
                walletSnap.data();


            const ledgerSnap =
                await transaction.get(
                    ledgerRef
                );


            if (ledgerSnap.exists) {

                return;

            }


            const locked =
                Number(
                    wallet.lockedBalance || 0
                );


            if (
                locked <
                withdrawalAmount
            ) {

                throw new Error(
                    "Locked withdrawal balance is insufficient"
                );

            }


            const available =
                Number(
                    wallet.availableBalance || 0
                );


            transaction.update(

                walletRef,

                {

                    lockedBalance:
                        locked -
                        withdrawalAmount,

                    availableBalance:
                        available +
                        withdrawalAmount,

                    updatedAt:
                        new Date(),

                }

            );


            transaction.set(

                ledgerRef,

                {

                    ledgerId:
                        ledgerRef.id,

                    userId:
                        sellerId,

                    withdrawalId,

                    type:
                        "WITHDRAWAL_REVERSED",

                    amount:
                        withdrawalAmount,

                    reason,

                    status:
                        "REVERSED",

                    createdAt:
                        new Date(),

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
            "REVERSED",

    };

}


module.exports = {

    getOrCreateSellerWallet,

    addPendingEarnings,

    releaseSellerEarnings,

    lockWithdrawalFunds,

    completeWithdrawal,

    reverseWithdrawal,

};