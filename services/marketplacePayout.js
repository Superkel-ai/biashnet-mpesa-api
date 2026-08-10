const {
    db
} = require("../config/firebase");

const {
    FieldValue
} = require("firebase-admin/firestore");

const {
    recordSellerCreditLedger
} = require("./marketplaceLedger");


/*
==================================================
MARKETPLACE PAYOUT SERVICE
==================================================

IMPORTANT:

This service does NOT directly pay the seller's
M-PESA.

It releases the seller's marketplace earnings
into the seller's AVAILABLE wallet balance.

Actual withdrawal is handled by:

marketplaceWithdrawal.js

Flow:

BUYER PAYS
      ↓
PAYMENT CONFIRMED
      ↓
ORDER CREATED / PAID
      ↓
BUYER RECEIVES PRODUCT
      ↓
BUYER GIVES DELIVERY CODE
      ↓
SELLER ENTERS CODE
      ↓
ORDER COMPLETED
      ↓
PAYOUT RELEASED
      ↓
SELLER AVAILABLE BALANCE
      ↓
SELLER WITHDRAWS
==================================================
*/


/*
==================================================
RELEASE SELLER PAYOUT
==================================================
*/

async function releaseSellerPayout({

    orderId,

    sellerId,

    orderAmount,

    commission,

    reference = null,

}) {

    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }


    if (!sellerId) {

        throw new Error(
            "Seller ID is required."
        );

    }


    const grossAmount =
        Number(orderAmount);


    const commissionAmount =
        Number(commission);


    if (
        !Number.isFinite(grossAmount) ||
        grossAmount <= 0
    ) {

        throw new Error(
            "Invalid order amount."
        );

    }


    if (
        !Number.isFinite(commissionAmount) ||
        commissionAmount < 0
    ) {

        throw new Error(
            "Invalid commission."
        );

    }


    const sellerAmount =
        grossAmount -
        commissionAmount;


    if (sellerAmount <= 0) {

        throw new Error(
            "Seller payout must be greater than zero."
        );

    }


    /*
    ==================================================
    REFERENCES
    ==================================================
    */

    const orderRef =
        db
            .collection("marketplaceOrders")
            .doc(orderId);


    const walletRef =
        db
            .collection("marketplaceSellerWallets")
            .doc(sellerId);


    const payoutRef =
        db
            .collection("marketplacePayouts")
            .doc();


    /*
    ==================================================
    TRANSACTION
    ==================================================
    */

    const result =
        await db.runTransaction(
            async (transaction) => {

                /*
                --------------------------------------
                CHECK ORDER
                --------------------------------------
                */

                const orderSnap =
                    await transaction.get(
                        orderRef
                    );


                if (!orderSnap.exists) {

                    throw new Error(
                        "Marketplace order not found."
                    );

                }


                const order =
                    orderSnap.data();


                /*
                --------------------------------------
                PREVENT DOUBLE PAYOUT
                --------------------------------------
                */

                if (
                    order.payoutReleased === true
                ) {

                    throw new Error(
                        "Seller payout has already been released."
                    );

                }


                /*
                --------------------------------------
                ORDER MUST BE COMPLETED
                --------------------------------------
                */

                if (
                    order.status !== "COMPLETED"
                ) {

                    throw new Error(
                        "Order must be completed before seller payout."
                    );

                }


                /*
                --------------------------------------
                WALLET
                --------------------------------------
                */

                const walletSnap =
                    await transaction.get(
                        walletRef
                    );


                let wallet = {};


                if (walletSnap.exists) {

                    wallet =
                        walletSnap.data();

                }


                const availableBalance =
                    Number(
                        wallet.availableBalance || 0
                    );


                const pendingBalance =
                    Number(
                        wallet.pendingBalance || 0
                    );


                const totalEarned =
                    Number(
                        wallet.totalEarned || 0
                    );


                /*
                --------------------------------------
                CREATE PAYOUT
                --------------------------------------
                */

                const payout = {

                    payoutId:
                        payoutRef.id,

                    orderId,

                    sellerId,

                    grossAmount,

                    commission:
                        commissionAmount,

                    sellerAmount,

                    status:
                        "AVAILABLE",

                    reference,

                    createdAt:
                        FieldValue.serverTimestamp(),

                };


                transaction.set(
                    payoutRef,
                    payout
                );


                /*
                --------------------------------------
                UPDATE SELLER WALLET
                --------------------------------------
                */

                transaction.set(

                    walletRef,

                    {

                        sellerId,

                        availableBalance:
                            availableBalance +
                            sellerAmount,

                        pendingBalance:
                            Math.max(
                                0,
                                pendingBalance -
                                sellerAmount
                            ),

                        totalEarned:
                            totalEarned +
                            sellerAmount,

                        updatedAt:
                            FieldValue.serverTimestamp(),

                    },

                    {
                        merge: true
                    }

                );


                /*
                --------------------------------------
                MARK ORDER PAYOUT RELEASED
                --------------------------------------
                */

                transaction.update(

                    orderRef,

                    {

                        payoutReleased:
                            true,

                        payoutId:
                            payoutRef.id,

                        sellerPayout:
                            sellerAmount,

                        commission:
                            commissionAmount,

                        payoutReleasedAt:
                            FieldValue.serverTimestamp(),

                    }

                );


                return {

                    payoutId:
                        payoutRef.id,

                    sellerId,

                    grossAmount,

                    commission:
                        commissionAmount,

                    sellerAmount,

                };

            }
        );


    /*
    ==================================================
    LEDGER
    ==================================================
    */

    await recordSellerCreditLedger({

        orderId,

        sellerId,

        amount:
            grossAmount,

        commission:
            commissionAmount,

        reference,

    });


    return result;

}


/*
==================================================
MOVE PAYMENT TO PENDING SELLER BALANCE
==================================================

Call this after successful buyer payment.

The money is NOT withdrawable yet.

It remains pending until delivery is confirmed.
==================================================
*/

async function createPendingSellerPayout({

    orderId,

    sellerId,

    sellerAmount,

}) {

    const walletRef =
        db
            .collection(
                "marketplaceSellerWallets"
            )
            .doc(sellerId);


    const payoutRef =
        db
            .collection(
                "marketplacePayouts"
            )
            .doc();


    await db.runTransaction(
        async (transaction) => {

            const walletSnap =
                await transaction.get(
                    walletRef
                );


            const wallet =
                walletSnap.exists
                    ? walletSnap.data()
                    : {};


            const pendingBalance =
                Number(
                    wallet.pendingBalance || 0
                );


            transaction.set(

                walletRef,

                {

                    sellerId,

                    pendingBalance:
                        pendingBalance +
                        Number(sellerAmount),

                    updatedAt:
                        FieldValue.serverTimestamp(),

                },

                {
                    merge: true
                }

            );


            transaction.set(

                payoutRef,

                {

                    payoutId:
                        payoutRef.id,

                    orderId,

                    sellerId,

                    sellerAmount:
                        Number(sellerAmount),

                    status:
                        "PENDING",

                    createdAt:
                        FieldValue.serverTimestamp(),

                }

            );

        }
    );


    return {

        payoutId:
            payoutRef.id,

        orderId,

        sellerId,

        sellerAmount:
            Number(sellerAmount),

        status:
            "PENDING",

    };

}


module.exports = {

    createPendingSellerPayout,

    releaseSellerPayout,

};