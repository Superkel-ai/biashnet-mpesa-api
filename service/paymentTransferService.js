const {
    db
} = require("../config/firebase");

const {
    COLLECTIONS
} = require("../config/collections");

const {
    PAYMENT_STATUS,
    SELLER_PAYMENT_STATUS,
    PAYOUT_STATUS,
    TRANSACTION_TYPES
} = require("../config/paymentConstants");

const {
    addMoney,
    subtractMoney
} = require("../utils/money");


/*
=========================================================
PAYMENT TRANSFER SERVICE
=========================================================

PURPOSE

Moves a seller's HELD marketplace earnings into the
seller's AVAILABLE wallet balance after the order has
been successfully completed.

IMPORTANT:

This service does NOT:

- collect buyer payment
- initiate M-PESA STK
- create the order
- calculate commission
- approve refunds
- withdraw money to M-PESA

Those responsibilities belong to other services.

FLOW:

Buyer pays
   ↓
Payment callback
   ↓
Payment completed
   ↓
Seller funds HELD
   ↓
Buyer receives completion code
   ↓
Buyer gives code to seller
   ↓
Seller confirms delivery
   ↓
Order becomes COMPLETED
   ↓
Settlement approves release
   ↓
THIS SERVICE
   ↓
Seller wallet AVAILABLE balance increases
=========================================================
*/


/*
=========================================================
VALIDATION HELPERS
=========================================================
*/

function requireValue(value, message) {

    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {

        throw new Error(message);

    }

}


/*
=========================================================
TRANSFER HELD FUNDS TO SELLER WALLET
=========================================================

This is the main function.

Expected input:

{
    orderId
}

The service obtains all financial information from
Firestore.

The frontend NEVER tells us:

- sellerId
- amount
- commission
- sellerNet

Those values come from the trusted order/payment records.
=========================================================
*/

async function transferSellerFunds({
    orderId
}) {

    requireValue(
        orderId,
        "Order ID is required."
    );


    const orderRef =
        db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(orderId);


    /*
    =====================================================
    RUN ATOMIC TRANSACTION
    =====================================================

    This is extremely important.

    If the seller taps:

        "Complete Order"

    twice,

    we must NOT release the money twice.

    Firestore transaction protects the operation.
    =====================================================
    */

    let transferResult;


    await db.runTransaction(
        async (transaction) => {

            /*
            =============================================
            READ ORDER
            =============================================
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
            =============================================
            VERIFY ORDER STATUS
            =============================================
            */

            if (
                order.status !==
                "COMPLETED"
            ) {

                throw new Error(
                    "Order must be COMPLETED before seller funds can be released."
                );

            }


            /*
            =============================================
            VERIFY PAYMENT
            =============================================
            */

            if (
                order.paymentStatus !==
                PAYMENT_STATUS.COMPLETED
            ) {

                throw new Error(
                    "Payment has not been completed."
                );

            }


            /*
            =============================================
            VERIFY SELLER PAYMENT STATUS
            =============================================
            */

            if (
                order.sellerPaymentStatus !==
                SELLER_PAYMENT_STATUS.HELD
            ) {

                /*
                -----------------------------------------
                ALREADY RELEASED
                -----------------------------------------

                This makes the operation idempotent.

                If another request already released the
                money, do not release it again.
                -----------------------------------------
                */

                if (
                    order.sellerPaymentStatus ===
                    SELLER_PAYMENT_STATUS.RELEASED
                ) {

                    transferResult = {

                        alreadyReleased: true,

                        orderId,

                        sellerId:
                            order.sellerId,

                        amount:
                            Number(
                                order.sellerNet || 0
                            ),

                        status:
                            SELLER_PAYMENT_STATUS.RELEASED

                    };

                    return;

                }


                throw new Error(
                    "Seller funds are not currently held."
                );

            }


            /*
            =============================================
            SELLER
            =============================================
            */

            const sellerId =
                order.sellerId;


            requireValue(
                sellerId,
                "Order does not contain a seller."
            );


            /*
            =============================================
            SELLER AMOUNT
            =============================================

            sellerNet is calculated when the order/payment
            is created.

            Example:

            Buyer pays       = 1,000

            Commission 15%   = 150

            Seller gross      = 850

            Seller net        = 850

            The exact field used by your order system
            should be the authoritative seller amount.
            =============================================
            */

            const sellerAmount =
                Number(
                    order.sellerNet ??
                    order.sellerGross ??
                    0
                );


            if (
                !Number.isFinite(
                    sellerAmount
                ) ||
                sellerAmount <= 0
            ) {

                throw new Error(
                    "Invalid seller settlement amount."
                );

            }


            /*
            =============================================
            WALLET
            =============================================
            */

            const walletRef =
                db
                    .collection(
                        COLLECTIONS.WALLETS
                    )
                    .doc(sellerId);


            const walletSnap =
                await transaction.get(
                    walletRef
                );


            /*
            =============================================
            CREATE WALLET IF NECESSARY
            =============================================
            */

            let wallet = {};


            if (
                walletSnap.exists
            ) {

                wallet =
                    walletSnap.data();

            }


            const currentAvailable =
                Number(
                    wallet.availableBalance ||
                    0
                );


            const currentHeld =
                Number(
                    wallet.heldBalance ||
                    0
                );


            /*
            =============================================
            VERIFY HELD BALANCE
            =============================================

            Normally the seller's wallet should already
            contain the held amount.

            We do not blindly subtract below zero.
            =============================================
            */

            if (
                currentHeld < sellerAmount
            ) {

                throw new Error(
                    "Seller wallet does not contain enough held funds."
                );

            }


            /*
            =============================================
            CALCULATE NEW BALANCES
            =============================================
            */

            const newHeld =
                subtractMoney(
                    currentHeld,
                    sellerAmount
                );


            const newAvailable =
                addMoney(
                    currentAvailable,
                    sellerAmount
                );


            const now =
                new Date();


            /*
            =============================================
            UPDATE WALLET
            =============================================
            */

            transaction.set(
                walletRef,
                {

                    userId:
                        sellerId,

                    availableBalance:
                        newAvailable,

                    heldBalance:
                        newHeld,

                    updatedAt:
                        now

                },

                {
                    merge: true
                }

            );


            /*
            =============================================
            UPDATE ORDER
            =============================================
            */

            transaction.update(
                orderRef,
                {

                    sellerPaymentStatus:
                        SELLER_PAYMENT_STATUS.RELEASED,

                    payoutStatus:
                        PAYOUT_STATUS.COMPLETED,

                    sellerFundsReleased:
                        true,

                    sellerFundsReleasedAmount:
                        sellerAmount,

                    sellerFundsReleasedAt:
                        now,

                    updatedAt:
                        now

                }
            );


            /*
            =============================================
            CREATE FINANCIAL TRANSACTION
            =============================================
            */

            const transactionId =
                `PAYOUT-${Date.now()}-${Math.random()
                    .toString(36)
                    .substring(2, 8)
                    .toUpperCase()}`;


            const financialTransactionRef =
                db
                    .collection(
                        COLLECTIONS.TRANSACTIONS
                    )
                    .doc(
                        transactionId
                    );


            transaction.set(
                financialTransactionRef,
                {

                    transactionId,

                    type:
                        TRANSACTION_TYPES.SELLER_PAYOUT,

                    orderId,

                    paymentId:
                        order.paymentId ||
                        null,

                    sellerId,

                    buyerId:
                        order.buyerId ||
                        null,

                    amount:
                        sellerAmount,

                    currency:
                        "KES",

                    direction:
                        "CREDIT",

                    status:
                        PAYMENT_STATUS.COMPLETED,

                    source:
                        "MARKETPLACE_ORDER",

                    description:
                        "Seller marketplace earnings released after order completion.",

                    createdAt:
                        now,

                    updatedAt:
                        now

                }
            );


            /*
            =============================================
            RESULT
            =============================================
            */

            transferResult = {

                alreadyReleased:
                    false,

                orderId,

                sellerId,

                amount:
                    sellerAmount,

                transactionId,

                status:
                    SELLER_PAYMENT_STATUS.RELEASED

            };

        }
    );


    return {

        success: true,

        ...transferResult

    };

}


/*
=========================================================
GET SELLER TRANSFER STATUS
=========================================================
*/

async function getSellerTransferStatus({
    orderId
}) {

    requireValue(
        orderId,
        "Order ID is required."
    );


    const orderSnap =
        await db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(orderId)
            .get();


    if (
        !orderSnap.exists
    ) {

        throw new Error(
            "Marketplace order not found."
        );

    }


    const order =
        orderSnap.data();


    return {

        orderId,

        sellerId:
            order.sellerId ||
            null,

        sellerPaymentStatus:
            order.sellerPaymentStatus ||
            SELLER_PAYMENT_STATUS.NOT_RELEASED,

        payoutStatus:
            order.payoutStatus ||
            PAYOUT_STATUS.NOT_RELEASED,

        amount:
            Number(
                order.sellerNet ||
                order.sellerGross ||
                0
            ),

        released:
            order.sellerPaymentStatus ===
            SELLER_PAYMENT_STATUS.RELEASED,

        releasedAt:
            order.sellerFundsReleasedAt ||
            null

    };

}


/*
=========================================================
EXPORT
=========================================================
*/

module.exports = {

    transferSellerFunds,

    getSellerTransferStatus

};