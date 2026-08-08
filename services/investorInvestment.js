const { db } = require("../config/firebase");

/**
 * RECORD OFFLINE INVESTMENT
 *
 * Financial flow:
 *
 * OFFLINE PAYMENT
 *      ↓
 * TRANSACTION
 *      ↓
 * WALLET
 *      ↓
 * INVESTOR
 *      ↓
 * COMPANY INVESTMENT STATS
 *
 * Everything is written atomically.
 *
 * If any part fails, nothing is updated.
 *
 * Designed for:
 * - Cash payments
 * - Bank transfers
 * - M-Pesa sent manually
 * - Cheques
 * - Other offline/manual investments
 * - Admin-entered historical investments
 */

async function recordOfflineInvestment({
    userId,
    amount,
    reference,
    paymentMethod = "OFFLINE",
    note = "",
    adminId = null,
}) {

    /*
    ==================================================
    1. VALIDATION
    ==================================================
    */

    if (!userId) {
        throw new Error("Investor userId is required");
    }

    const investmentAmount = Number(amount);

    if (
        !Number.isFinite(investmentAmount) ||
        investmentAmount <= 0
    ) {
        throw new Error("Invalid investment amount");
    }


    /*
    ==================================================
    2. REFERENCES
    ==================================================
    */

    const investorRef =
        db.collection("investor").doc(userId);

    const walletRef =
        db.collection("wallets").doc(userId);

    const statsRef =
        db.collection("investmentStats").doc("company");


    /*
    ==================================================
    3. CHECK INVESTOR EXISTS
    ==================================================
    */

    const investorSnap =
        await investorRef.get();

    if (!investorSnap.exists) {
        throw new Error(
            "Investor account not found"
        );
    }


    /*
    ==================================================
    4. CREATE UNIQUE TRANSACTION ID
    ==================================================
    */

    /*
     * If the administrator provides a payment reference,
     * use it as part of the transaction ID.
     *
     * This is useful for:
     *
     * MPESA:
     * QWE123ABC
     *
     * BANK:
     * BANK-20260808-001
     *
     * CASH:
     * CASH-20260808-001
     */

    const cleanReference =
        reference
            ? String(reference)
                .trim()
                .replace(/\s+/g, "-")
                .toUpperCase()
            : null;


    const transactionId =
        cleanReference
            ? `OFFLINE-${cleanReference}`
            : `OFFLINE-${userId}-${Date.now()}`;


    const transactionRef =
        db.collection("transactions")
        .doc(transactionId);


    /*
    ==================================================
    5. FIRESTORE ATOMIC TRANSACTION
    ==================================================
    */

    await db.runTransaction(
        async (transaction) => {

            /*
            ------------------------------------------
            READ ALL DOCUMENTS FIRST
            ------------------------------------------
            */

            const existingTransaction =
                await transaction.get(
                    transactionRef
                );

            const walletSnap =
                await transaction.get(
                    walletRef
                );

            const statsSnap =
                await transaction.get(
                    statsRef
                );


            /*
            ------------------------------------------
            DUPLICATE PROTECTION
            ------------------------------------------
            */

            if (existingTransaction.exists) {

                throw new Error(
                    "This offline payment has already been recorded."
                );

            }


            /*
            ------------------------------------------
            CURRENT DATA
            ------------------------------------------
            */

            const investor =
                investorSnap.data();

            const wallet =
                walletSnap.exists
                    ? walletSnap.data()
                    : {};

            const stats =
                statsSnap.exists
                    ? statsSnap.data()
                    : {};


            /*
            ------------------------------------------
            CURRENT WALLET VALUES
            ------------------------------------------
            */

            const oldBalance =
                Number(wallet.balance || 0);

            const oldTotalDeposits =
                Number(wallet.totalDeposits || 0);


            /*
            ------------------------------------------
            CURRENT INVESTOR VALUES
            ------------------------------------------
            */

            const oldTotalInvested =
                Number(
                    investor.totalInvested || 0
                );

            const oldContributions =
                Number(
                    investor.contributionsCount || 0
                );


            /*
            ------------------------------------------
            CURRENT COMPANY STATS
            ------------------------------------------
            */

            const oldTotalRaised =
                Number(
                    stats.totalRaised || 0
                );


            /*
            ------------------------------------------
            INVESTOR COUNT
            ------------------------------------------
            */

            /*
             * DO NOT simply do:
             *
             * totalInvestors + 1
             *
             * because this investor may already exist.
             *
             * We use the investor's existing investment
             * status to determine whether this is their
             * first contribution.
             */

            const wasAlreadyInvestor =
                oldTotalInvested > 0;

            const currentTotalInvestors =
                Number(
                    stats.totalInvestors || 0
                );


            const newTotalInvestors =
                wasAlreadyInvestor
                    ? currentTotalInvestors
                    : currentTotalInvestors + 1;


            /*
            ------------------------------------------
            NEW WALLET VALUES
            ------------------------------------------
            */

            const newBalance =
                oldBalance +
                investmentAmount;

            const newTotalDeposits =
                oldTotalDeposits +
                investmentAmount;


            /*
            ------------------------------------------
            NEW INVESTOR VALUES
            ------------------------------------------
            */

            const newTotalInvested =
                oldTotalInvested +
                investmentAmount;

            const newContributions =
                oldContributions + 1;


            /*
            ------------------------------------------
            NEW COMPANY VALUES
            ------------------------------------------
            */

            const newTotalRaised =
                oldTotalRaised +
                investmentAmount;


            /*
            ==================================================
            UPDATE WALLET
            ==================================================
            */

            transaction.set(
                walletRef,
                {

                    uid: userId,

                    balance:
                        newBalance,

                    totalDeposits:
                        newTotalDeposits,

                    updatedAt:
                        new Date(),

                },
                {
                    merge: true
                }
            );


            /*
            ==================================================
            UPDATE INVESTOR
            ==================================================
            */

            transaction.set(
                investorRef,
                {

                    uid:
                        userId,

                    walletBalance:
                        newBalance,

                    totalInvested:
                        newTotalInvested,

                    contributionsCount:
                        newContributions,

                    status:
                        "active",

                    updatedAt:
                        new Date(),

                },
                {
                    merge: true
                }
            );


            /*
            ==================================================
            SAVE TRANSACTION
            ==================================================
            */

            transaction.set(
                transactionRef,
                {

                    transactionId,

                    userId,

                    amount:
                        investmentAmount,

                    type:
                        "OFFLINE_INVESTMENT",

                    status:
                        "COMPLETED",

                    paymentMethod:
                        paymentMethod || "OFFLINE",

                    reference:
                        cleanReference,

                    note:
                        note || null,

                    adminId:
                        adminId || null,

                    createdAt:
                        new Date(),

                    updatedAt:
                        new Date(),

                }
            );


            /*
            ==================================================
            UPDATE COMPANY INVESTMENT STATS
            ==================================================
            */

            transaction.set(
                statsRef,
                {

                    totalRaised:
                        newTotalRaised,

                    totalInvestors:
                        newTotalInvestors,

                    updatedAt:
                        new Date(),

                },
                {
                    merge: true
                }
            );

        }
    );


    /*
    ==================================================
    6. RETURN RESULT
    ==================================================
    */

    return {

        success:
            true,

        transactionId,

        userId,

        amount:
            investmentAmount,

        paymentMethod,

        reference:
            cleanReference,

    };

}


module.exports = {
    recordOfflineInvestment
};