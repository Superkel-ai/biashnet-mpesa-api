const { db } = require("../config/firebase");

async function updateInvestmentStats(){

    const investors =
        await db.collection("investor")
        .get();

    let totalRaised = 0;

    investors.forEach(doc=>{

        totalRaised +=
            Number(
                doc.data()
                .totalInvested || 0
            );

    });

    await db
        .collection("investmentStats")
        .doc("company")
        .set({

            totalRaised,

            totalInvestors:
                investors.size,

            updatedAt:
                new Date()

        },

        { merge:true }

        );

}

module.exports = {
updateInvestmentStats
};