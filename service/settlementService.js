/*
=========================================================
BIASHNET SETTLEMENT SERVICE
=========================================================

RESPONSIBILITY
---------------------------------------------------------

Releases seller funds AFTER:

1. Buyer payment is completed
2. Funds have been placed on HOLD
3. Order has been delivered
4. Buyer gives completion code
5. Seller verifies completion code
6. Order becomes COMPLETED
7. Settlement releases seller funds

FLOW:

PAYMENT
   ↓
SELLER FUNDS HELD
   ↓
SELLER PENDING BALANCE
   ↓
DELIVERY
   ↓
COMPLETION CODE VERIFIED
   ↓
ORDER COMPLETED
   ↓
SETTLEMENT SERVICE
   ↓
PENDING BALANCE DECREASED
   ↓
AVAILABLE BALANCE INCREASED
   ↓
SELLER CAN WITHDRAW

IMPORTANT:

This service does NOT:

- initiate M-Pesa
- process STK
- process callbacks
- verify completion codes
- initiate withdrawals

Those belong to other services.

Settlement is:

- atomic
- idempotent
- server-authoritative
- ledger-based
=========================================================
*/

const {
    db,
    FieldValue,
} = require("../config/firebase");

const {
    COLLECTIONS,
} = require("../config/collections");

const {
    PAYMENT_STATUS,
    ORDER_STATUS,
    SELLER_PAYMENT_STATUS,
    PAYOUT_STATUS,
    TRANSACTION_TYPES,
} = require("../config/paymentConstants");


/*
=========================================================
MONEY HELPER
=========================================================
*/

function toMoney(value) {

    const amount = Number(value);

    if (!Number.isFinite(amount)) {

        return 0;

    }

    return Number(
        amount.toFixed(2)
    );

}


/*
=========================================================
WALLET REFERENCE
=========================================================
*/

function getWalletRef(sellerId) {

    if (!sellerId) {

        throw new Error(
            "Seller ID is required for wallet."
        );

    }

    return db
        .collection(
            COLLECTIONS.WALLETS
        )
        .doc(sellerId);

}


/*
=========================================================
SETTLE MARKETPLACE ORDER
=========================================================

IMPORTANT:

This function assumes:

ONE MARKETPLACE ORDER
        =
ONE SELLER

That is why checkout should split a multi-seller
cart into separate marketplace orders.

=========================================================
*/

async function settleMarketplaceOrder({

    orderId,

    sellerId,

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


    const orderRef =
        db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(orderId);


    const walletRef =
        getWalletRef(
            sellerId
        );


    let result;


    /*
    =====================================================
    ATOMIC SETTLEMENT
    =====================================================
    */

    await db.runTransaction(
        async (transaction) => {

            /*
            ---------------------------------------------
            READ ORDER
            ---------------------------------------------
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
            ---------------------------------------------
            VERIFY SELLER
            ---------------------------------------------
            */

            if (
                order.sellerId !==
                sellerId
            ) {

                throw new Error(
                    "Seller is not authorized to settle this order."
                );

            }


            /*
            ---------------------------------------------
            IDEMPOTENCY CHECK
            ---------------------------------------------
            */

            if (
                order.settlementStatus ===
                "SETTLED"
            ) {

                result = {

                    success: true,

                    alreadySettled: true,

                    orderId,

                    sellerId,

                    sellerAmount:
                        toMoney(
                            order.sellerPayoutAmount
                        ),

                    status:
                        "SETTLED",

                };

                return;

            }


            /*
            ---------------------------------------------
            PAYMENT MUST BE COMPLETED
            ---------------------------------------------
            */

            if (
                order.paymentStatus !==
                PAYMENT_STATUS.COMPLETED
            ) {

                throw new Error(
                    "Order payment has not been completed."
                );

            }


            /*
            ---------------------------------------------
            ORDER MUST BE COMPLETED
            ---------------------------------------------
            */

            if (
                order.status !==
                ORDER_STATUS.COMPLETED
            ) {

                throw new Error(
                    "Order must be completed before settlement."
                );

            }


            /*
            ---------------------------------------------
            FUNDS MUST STILL BE HELD
            ---------------------------------------------
            */

            if (
                order.sellerPaymentStatus !==
                SELLER_PAYMENT_STATUS.HELD
            ) {

                throw new Error(
                    "Seller funds are not in HELD state."
                );

            }


            /*
            ---------------------------------------------
            AUTHORITATIVE SELLER AMOUNT
            ---------------------------------------------
            */

            const sellerAmount =
                toMoney(
                    order.sellerNet
                );


            const commissionAmount =
                toMoney(
                    order.commissionAmount
                );


            const buyerTotal =
                toMoney(
                    order.buyerTotal
                );


            if (
                sellerAmount <= 0
            ) {

                throw new Error(
                    "Invalid seller settlement amount."
                );

            }


            /*
            ---------------------------------------------
            READ WALLET
            ---------------------------------------------
            */

            const walletSnap =
                await transaction.get(
                    walletRef
                );


            const wallet =
                walletSnap.exists
                    ? walletSnap.data()
                    : {};


            const availableBalance =
                toMoney(
                    wallet.availableBalance
                );


            const pendingBalance =
                toMoney(
                    wallet.pendingBalance
                );


            const totalEarned =
                toMoney(
                    wallet.totalEarned
                );


            /*
            ---------------------------------------------
            VERIFY HELD MONEY
            ---------------------------------------------

            Payment processing should have already moved
            seller funds into pendingBalance.

            Therefore settlement must NEVER create money
            out of nowhere.
            ---------------------------------------------
            */

            if (
                pendingBalance <
                sellerAmount
            ) {

                throw new Error(
                    `Insufficient held seller funds. Pending balance: KES ${pendingBalance}, required: KES ${sellerAmount}.`
                );

            }


            /*
            ---------------------------------------------
            NEW WALLET BALANCES
            ---------------------------------------------
            */

            const newPendingBalance =
                toMoney(
                    pendingBalance -
                    sellerAmount
                );


            const newAvailableBalance =
                toMoney(
                    availableBalance +
                    sellerAmount
                );


            const newTotalEarned =
                toMoney(
                    totalEarned +
                    sellerAmount
                );


            /*
            ---------------------------------------------
            UPDATE SELLER WALLET
            ---------------------------------------------
            */

            transaction.set(

                walletRef,

                {

                    userId:
                        sellerId,

                    availableBalance:
                        newAvailableBalance,

                    pendingBalance:
                        newPendingBalance,

                    totalEarned:
                        newTotalEarned,

                    updatedAt:
                        FieldValue.serverTimestamp(),

                },

                {
                    merge: true
                }

            );


            /*
            ---------------------------------------------
            CREATE SELLER SETTLEMENT TRANSACTION
            ---------------------------------------------
            */

            const settlementRef =
                db
                    .collection(
                        COLLECTIONS.TRANSACTIONS
                    )
                    .doc();


            transaction.set(

                settlementRef,

                {

                    transactionId:
                        settlementRef.id,

                    type:
                        TRANSACTION_TYPES.SELLER_PAYOUT,

                    orderId,

                    sellerId,

                    buyerId:
                        order.buyerId ||
                        null,

                    paymentId:
                        order.paymentId ||
                        null,

                    amount:
                        sellerAmount,

                    saleAmount:
                        buyerTotal,

                    commissionAmount,

                    currency:
                        "KES",

                    status:
                        PAYMENT_STATUS.COMPLETED,

                    payoutStatus:
                        PAYOUT_STATUS.COMPLETED,

                    direction:
                        "CREDIT",

                    source:
                        "MARKETPLACE_ORDER",

                    description:
                        `Seller settlement for order ${orderId}`,

                    createdAt:
                        FieldValue.serverTimestamp(),

                    completedAt:
                        FieldValue.serverTimestamp(),

                }

            );


            /*
            ---------------------------------------------
            COMPANY COMMISSION LEDGER
            ---------------------------------------------
            */

            if (
                commissionAmount > 0
            ) {

                const commissionRef =
                    db
                        .collection(
                            COLLECTIONS.TRANSACTIONS
                        )
                        .doc();


                transaction.set(

                    commissionRef,

                    {

                        transactionId:
                            commissionRef.id,

                        type:
                            TRANSACTION_TYPES.COMMISSION,

                        orderId,

                        paymentId:
                            order.paymentId ||
                            null,

                        sellerId,

                        buyerId:
                            order.buyerId ||
                            null,

                        amount:
                            commissionAmount,

                        currency:
                            "KES",

                        status:
                            PAYMENT_STATUS.COMPLETED,

                        direction:
                            "CREDIT",

                        recipient:
                            "BIASHNET",

                        source:
                            "MARKETPLACE_ORDER",

                        description:
                            `Biashnet commission for order ${orderId}`,

                        createdAt:
                            FieldValue.serverTimestamp(),

                    }

                );

            }


            /*
            ---------------------------------------------
            UPDATE ORDER
            ---------------------------------------------
            */

            transaction.update(

                orderRef,

                {

                    sellerPaymentStatus:
                        SELLER_PAYMENT_STATUS.RELEASED,

                    payoutStatus:
                        PAYOUT_STATUS.COMPLETED,

                    sellerPayoutAmount:
                        sellerAmount,

                    commissionSettled:
                        commissionAmount,

                    settlementStatus:
                        "SETTLED",

                    settlementTransactionId:
                        settlementRef.id,

                    settledAt:
                        FieldValue.serverTimestamp(),

                    fundsHeld:
                        false,

                    fundsReleased:
                        true,

                    updatedAt:
                        FieldValue.serverTimestamp(),

                }

            );


            /*
            ---------------------------------------------
            RESULT
            ---------------------------------------------
            */

            result = {

                success: true,

                alreadySettled: false,

                orderId,

                sellerId,

                saleAmount:
                    buyerTotal,

                commissionAmount,

                sellerAmount,

                status:
                    "SETTLED",

            };

        }
    );


    console.log(
        "=========================================="
    );

    console.log(
        "✅ MARKETPLACE SETTLEMENT COMPLETE"
    );

    console.log(
        result
    );

    console.log(
        "=========================================="
    );


    return result;

}


/*
=========================================================
GET SETTLEMENT STATUS
=========================================================
*/

async function getSettlementStatus(
    orderId
) {

    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }


    const orderSnap =
        await db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(orderId)
            .get();


    if (!orderSnap.exists) {

        return null;

    }


    const order =
        orderSnap.data();


    return {

        orderId,

        status:
            order.status ||
            null,

        paymentStatus:
            order.paymentStatus ||
            null,

        sellerPaymentStatus:
            order.sellerPaymentStatus ||
            null,

        payoutStatus:
            order.payoutStatus ||
            null,

        settlementStatus:
            order.settlementStatus ||
            "NOT_SETTLED",

        sellerPayoutAmount:
            toMoney(
                order.sellerPayoutAmount
            ),

        commissionSettled:
            toMoney(
                order.commissionSettled
            ),

        fundsHeld:
            order.fundsHeld === true,

        fundsReleased:
            order.fundsReleased === true,

        settledAt:
            order.settledAt ||
            null,

    };

}


/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

    settleMarketplaceOrder,

    getSettlementStatus,

};