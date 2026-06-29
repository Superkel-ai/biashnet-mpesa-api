const { db } = require("../config/firebase");

async function syncInvestor(userId) {

    const walletRef =
        db.collection("wallets")
        .doc(userId);

    const investorRef =
        db.collection("investor")
        .doc(userId);

    const walletDoc =
        await walletRef.get();

    if (!walletDoc.exists) return;

    const wallet =
        walletDoc.data();

    await investorRef.set({

        uid:userId,

        walletBalance:
            wallet.balance || 0,

        totalInvested:
            wallet.totalDeposits || 0,

        contributionsCount:
            wallet.totalDeposits > 0
                ? 1
                : 0,

        status:"active",

        updatedAt:new Date()

    },{ merge:true });

}

module.exports = {
    syncInvestor
};