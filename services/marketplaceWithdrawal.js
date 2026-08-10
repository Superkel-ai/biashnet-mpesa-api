const { db } = require("../config/firebase");

const {
    lockWithdrawalFunds,
} = require("./marketplaceSellerWallet");


/*
=========================================================
MARKETPLACE WITHDRAWAL SERVICE
=========================================================

Collections:

marketplaceWithdrawals
marketplaceWallets
marketplaceLedger

IMPORTANT:

This is completely separate from:

investor withdrawals
wallets
transactions
withdrawalRequests
=========================================================
*/


/*
=========================================================
CREATE WITHDRAWAL REQUEST
=========================================================
*/

async function createMarketplaceWithdrawal({

    sellerId,

    amount,

    phoneNumber,

}) {

    if (!sellerId) {

        throw new Error(
            "Seller ID is required"
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
            "Invalid withdrawal amount"
        );

    }


    if (!phoneNumber) {

        throw new Error(
            "Phone number is required"
        );

    }


    /*
    =============================================
    MINIMUM WITHDRAWAL
    =============================================
    */

    const MINIMUM_WITHDRAWAL = 50;


    if (
        withdrawalAmount <
        MINIMUM_WITHDRAWAL
    ) {

        throw new Error(
            `Minimum withdrawal is KES ${MINIMUM_WITHDRAWAL}`
        );

    }


    /*
    =============================================
    GENERATE WITHDRAWAL ID
    =============================================
    */

    const withdrawalId =
        `MW-${Date.now()}-${sellerId}`;


    const withdrawalRef =
        db.collection(
            "marketplaceWithdrawals"
        ).doc(withdrawalId);


    /*
    =============================================
    CHECK EXISTING PENDING WITHDRAWAL
    =============================================
    */

    const pendingSnap =
        await db
            .collection(
                "marketplaceWithdrawals"
            )
            .where(
                "sellerId",
                "==",
                sellerId
            )
            .where(
                "status",
                "in",
                [
                    "PENDING",
                    "PROCESSING"
                ]
            )
            .limit(1)
            .get();


    if (!pendingSnap.empty) {

        throw new Error(
            "You already have a withdrawal being processed."
        );

    }


    /*
    =============================================
    CREATE WITHDRAWAL + LOCK FUNDS
    =============================================
    */

    await db.runTransaction(
        async (transaction) => {

            /*
            -------------------------------------
            READ WALLET
            -------------------------------------
            */

            const walletRef =
                db.collection(
                    "marketplaceWallets"
                )
                .doc(sellerId);


            const walletSnap =
                await transaction.get(
                    walletRef
                );


            if (!walletSnap.exists) {

                throw new Error(
                    "Marketplace seller wallet not found."
                );

            }


            const wallet =
                walletSnap.data();


            const availableBalance =
                Number(
                    wallet.availableBalance || 0
                );


            /*
            -------------------------------------
            CHECK BALANCE
            -------------------------------------
            */

            if (
                availableBalance <
                withdrawalAmount
            ) {

                throw new Error(
                    "Insufficient available balance."
                );

            }


            /*
            -------------------------------------
            LOCK FUNDS
            -------------------------------------
            */

            const lockedBalance =
                Number(
                    wallet.lockedBalance || 0
                );


            transaction.update(

                walletRef,

                {

                    availableBalance:
                        availableBalance -
                        withdrawalAmount,

                    lockedBalance:
                        lockedBalance +
                        withdrawalAmount,

                    updatedAt:
                        new Date(),

                }

            );


            /*
            -------------------------------------
            CREATE WITHDRAWAL
            -------------------------------------
            */

            transaction.set(

                withdrawalRef,

                {

                    withdrawalId,

                    sellerId,

                    amount:
                        withdrawalAmount,

                    phoneNumber,

                    currency:
                        "KES",

                    status:
                        "PENDING",

                    provider:
                        "MPESA_B2C",

                    failureReason:
                        null,

                    mpesaConversationId:
                        null,

                    mpesaOriginatorConversationId:
                        null,

                    resultCode:
                        null,

                    resultDescription:
                        null,

                    createdAt:
                        new Date(),

                    updatedAt:
                        new Date(),

                }

            );

        }
    );


    /*
    =============================================
    LEDGER ENTRY
    =============================================
    */

    await db.collection(
        "marketplaceLedger"
    )
    .doc(
        `WITHDRAWAL-REQUEST-${withdrawalId}`
    )
    .set({

        ledgerId:
            `WITHDRAWAL-REQUEST-${withdrawalId}`,

        userId:
            sellerId,

        withdrawalId,

        type:
            "WITHDRAWAL_REQUESTED",

        amount:
            withdrawalAmount,

        status:
            "LOCKED",

        createdAt:
            new Date(),

    });


    return {

        success: true,

        withdrawalId,

        sellerId,

        amount:
            withdrawalAmount,

        phoneNumber,

        status:
            "PENDING",

    };

}


/*
=========================================================
MARK WITHDRAWAL AS PROCESSING
=========================================================
*/

async function markWithdrawalProcessing({

    withdrawalId,

    conversationId = null,

    originatorConversationId = null,

}) {

    if (!withdrawalId) {

        throw new Error(
            "Withdrawal ID is required"
        );

    }


    const withdrawalRef =
        db.collection(
            "marketplaceWithdrawals"
        )
        .doc(withdrawalId);


    await withdrawalRef.update({

        status:
            "PROCESSING",

        mpesaConversationId:
            conversationId,

        mpesaOriginatorConversationId:
            originatorConversationId,

        updatedAt:
            new Date(),

    });


    return {

        success: true,

        withdrawalId,

        status:
            "PROCESSING",

    };

}


/*
=========================================================
GET WITHDRAWAL
=========================================================
*/

async function getMarketplaceWithdrawal(
    withdrawalId
) {

    if (!withdrawalId) {

        throw new Error(
            "Withdrawal ID is required"
        );

    }


    const snap =
        await db
            .collection(
                "marketplaceWithdrawals"
            )
            .doc(withdrawalId)
            .get();


    if (!snap.exists) {

        throw new Error(
            "Withdrawal not found"
        );

    }


    return {

        id:
            snap.id,

        ...snap.data(),

    };

}


/*
=========================================================
GET SELLER WITHDRAWALS
=========================================================
*/

async function getSellerWithdrawals(
    sellerId
) {

    if (!sellerId) {

        throw new Error(
            "Seller ID is required"
        );

    }


    const snap =
        await db
            .collection(
                "marketplaceWithdrawals"
            )
            .where(
                "sellerId",
                "==",
                sellerId
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


module.exports = {

    createMarketplaceWithdrawal,

    markWithdrawalProcessing,

    getMarketplaceWithdrawal,

    getSellerWithdrawals,

};