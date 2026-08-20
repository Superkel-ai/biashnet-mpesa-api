const { db } = require("../config/firebase");

async function syncInvestor(userId) {

    if (!userId) {
        throw new Error("Investor userId is required");
    }

    const walletRef =
        db.collection("wallets")
        .doc(userId);

    const investorRef =
        db.collection("investor")
        .doc(userId);


    /*
    =========================================
    GET WALLET
    =========================================
    */

    const walletDoc =
        await walletRef.get();

    if (!walletDoc.exists) {
        throw new Error("Wallet not found");
    }

    const wallet =
        walletDoc.data();


    /*
    =========================================
    COUNT CONTRIBUTIONS
    =========================================

    Count completed investment transactions
    belonging to this investor.

    This means:

    Investment 1 = 1 contribution
    Investment 2 = 1 contribution
    Investment 3 = 1 contribution

    Total = 3 contributions

    =========================================
    */

    const transactionsSnap =
        await db
            .collection("transactions")
            .where("userId", "==", userId)
            .where("status", "==", "COMPLETED")
            .get();


    let contributionsCount = 0;


    transactionsSnap.forEach((doc) => {

        const transaction =
            doc.data();

        /*
        Count only actual investment
        transactions.

        This prevents withdrawals,
        deposits unrelated to investments,
        etc. from being counted.
        */

        if (
            transaction.type ===
                "OFFLINE_INVESTMENT" ||

            transaction.type ===
                "INVESTMENT" ||

            transaction.type ===
                "INVESTMENT_DEPOSIT"
        ) {

            contributionsCount++;

        }

    });


    /*
    =========================================
    INVESTOR VALUES
    =========================================
    */

    const walletBalance =
        Number(
            wallet.balance || 0
        );

    const totalInvested =
        Number(
            wallet.totalDeposits || 0
        );


    /*
    =========================================
    UPDATE INVESTOR
    =========================================
    */

    await investorRef.set({

        uid: userId,

        walletBalance,

        totalInvested,

        contributionsCount,

        status:
            totalInvested > 0
                ? "active"
                : "inactive",

        updatedAt:
            new Date(),

    }, {
        merge: true
    });


    /*
    =========================================
    RETURN
    =========================================
    */

    return {

        success: true,

        userId,

        walletBalance,

        totalInvested,

        contributionsCount,

    };

}


module.exports = {
    syncInvestor
};