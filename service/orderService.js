const {
    db,
    FieldValue,
} = require("../config/firebase");

const {
    COLLECTIONS,
} = require("../config/collections");

const {
    ORDER_STATUS,
    PAYMENT_STATUS,
    SELLER_PAYMENT_STATUS,
    PAYOUT_STATUS,
} = require("../config/paymentConstants");

const {
    hashCompletionCode,
    verifyCompletionCode,
    normalizeCompletionCode,
} = require("../utils/codeGenerator");


/*
=========================================================
BIASHNET ORDER SERVICE
=========================================================

RESPONSIBILITIES

1. Read marketplace orders
2. Verify buyer ownership
3. Verify seller ownership
4. Mark payment as initiated
5. Mark order as paid
6. Store payment information
7. Hold seller funds
8. Generate/store completion-code hash
9. Complete order using buyer's completion code
10. Prevent duplicate order completion

IMPORTANT

checkoutService is responsible for:

- validating cart
- validating products
- validating prices
- validating stock availability
- calculating subtotal
- calculating commission
- calculating seller earnings
- creating the initial order

This service therefore does NOT create a second,
different order structure.

PAYMENT SERVICES are responsible for:

- M-Pesa
- payment verification
- payment records
- callbacks

SETTLEMENT SERVICE is responsible for:

- releasing seller funds
- seller wallet credit
- settlement transactions

WITHDRAWAL SERVICE is responsible for:

- seller withdrawal
- M-Pesa B2C
=========================================================
*/


/*
=========================================================
GET ORDER
=========================================================
*/

async function getOrder(orderId) {

    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }


    const snapshot =
        await db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(orderId)
            .get();


    if (!snapshot.exists) {

        return null;

    }


    return {

        orderId:
            snapshot.id,

        ...snapshot.data(),

    };

}


/*
=========================================================
VERIFY BUYER
=========================================================
*/

async function verifyBuyer({

    order,

    buyerId,

}) {

    if (!order) {

        throw new Error(
            "Order not found."
        );

    }


    if (!buyerId) {

        throw new Error(
            "Buyer ID is required."
        );

    }


    if (
        order.buyerId !==
        buyerId
    ) {

        throw new Error(
            "You are not authorized to access this order."
        );

    }


    return true;

}


/*
=========================================================
VERIFY SELLER
=========================================================
*/

async function verifySeller({

    order,

    sellerId,

}) {

    if (!order) {

        throw new Error(
            "Order not found."
        );

    }


    if (!sellerId) {

        throw new Error(
            "Seller ID is required."
        );

    }


    /*
    =====================================================
    IMPORTANT

    checkoutService stores sellerId inside items.

    Therefore:

    Single-seller order:
        order.sellerId

    Multi-seller order:
        order.items[].sellerId

    We support both.
    =====================================================
    */

    if (
        order.sellerId === sellerId
    ) {

        return true;

    }


    if (
        Array.isArray(order.items)
    ) {

        const sellerOwnsItem =
            order.items.some(
                item =>
                    item.sellerId === sellerId
            );


        if (sellerOwnsItem) {

            return true;

        }

    }


    throw new Error(
        "You are not authorized to manage this order."
    );

}


/*
=========================================================
MARK PAYMENT INITIATED
=========================================================

Called by:

paymentInitiationService

AFTER:

- order exists
- buyer owns order
- payment request is accepted by M-Pesa/IntaSend
=========================================================
*/

async function markPaymentInitiated({

    orderId,

    paymentId,

    paymentMethod,

    checkoutRequestId,

    merchantRequestId,

    phoneNumber,

}) {

    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }


    const orderRef =
        db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(orderId);


    const orderSnapshot =
        await orderRef.get();


    if (!orderSnapshot.exists) {

        throw new Error(
            "Order not found."
        );

    }


    const order =
        orderSnapshot.data();


    /*
    =====================================================
    PREVENT PAYMENT INITIATION AFTER PAYMENT
    =====================================================
    */

    if (
        order.paymentStatus ===
        PAYMENT_STATUS.COMPLETED
    ) {

        throw new Error(
            "Order has already been paid."
        );

    }


    /*
    =====================================================
    PREVENT PAYMENT INITIATION FOR COMPLETED ORDER
    =====================================================
    */

    if (
        order.status ===
        ORDER_STATUS.COMPLETED
    ) {

        throw new Error(
            "Completed order cannot receive another payment."
        );

    }


    const now =
        FieldValue.serverTimestamp();


    await orderRef.update({

        status:
            ORDER_STATUS.PAYMENT_INITIATED,

        paymentStatus:
            PAYMENT_STATUS.INITIATED,

        paymentId:
            paymentId ||
            null,

        paymentMethod:
            paymentMethod ||
            null,

        checkoutRequestId:
            checkoutRequestId ||
            null,

        merchantRequestId:
            merchantRequestId ||
            null,

        buyerPhone:
            phoneNumber ||
            order.buyerPhone ||
            null,

        paymentInitiatedAt:
            now,

        updatedAt:
            now,

    });


    return getOrder(
        orderId
    );

}


/*
=========================================================
MARK ORDER PAID
=========================================================

IMPORTANT

This function should ONLY be called after:

1. Callback received
2. Callback verified
3. Correct order identified
4. Correct amount verified
5. Duplicate payment check passed

It:

- marks order PAID
- marks payment completed at order level
- marks seller funds HELD
- creates completion-code hash

It does NOT:

- credit seller wallet
- release seller money
- create seller payout

Those belong to settlementService.
=========================================================
*/

async function markOrderPaid({

    orderId,

    paymentId,

    providerTransactionId,

    paymentMethod = "MPESA",

    paidAmount,

    completionCode,

}) {

    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }


    /*
    =====================================================
    VALIDATE PAYMENT AMOUNT
    =====================================================
    */

    const receivedAmount =
        Number(paidAmount);


    if (
        !Number.isFinite(
            receivedAmount
        ) ||
        receivedAmount <= 0
    ) {

        throw new Error(
            "Invalid paid amount."
        );

    }


    /*
    =====================================================
    GET ORDER
    =====================================================
    */

    const orderRef =
        db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(orderId);


    const orderSnapshot =
        await orderRef.get();


    if (!orderSnapshot.exists) {

        throw new Error(
            "Order not found."
        );

    }


    const order =
        orderSnapshot.data();


    /*
    =====================================================
    EXPECTED AMOUNT
    =====================================================
    */

    const expectedAmount =
        Number(
            order.buyerTotal
        );


    if (
        !Number.isFinite(
            expectedAmount
        ) ||
        expectedAmount <= 0
    ) {

        throw new Error(
            "Order has an invalid buyer total."
        );

    }


    /*
    =====================================================
    AMOUNT VERIFICATION
    =====================================================
    */

    if (
        Math.abs(
            expectedAmount -
            receivedAmount
        ) > 0.01
    ) {

        throw new Error(
            `Payment amount mismatch. Expected KES ${expectedAmount}, received KES ${receivedAmount}.`
        );

    }


    /*
    =====================================================
    DUPLICATE CHECK
    =====================================================
    */

    if (
        order.paymentStatus ===
        PAYMENT_STATUS.COMPLETED
    ) {

        return {

            success:
                true,

            alreadyPaid:
                true,

            orderId,

            paymentId:
                order.paymentId ||
                paymentId ||
                null,

            status:
                order.status,

            paymentStatus:
                PAYMENT_STATUS.COMPLETED,

            completionCode:
                null,

            message:
                "Payment has already been processed.",

        };

    }


    /*
    =====================================================
    COMPLETION CODE

    IMPORTANT

    paymentCallbackService should generate the code
    or request this service to generate it.

    This service accepts the plain code and stores
    ONLY the hash.

    If no code is supplied, fail safely.
    =====================================================
    */

    const normalizedCode =
        normalizeCompletionCode(
            completionCode
        );


    if (!normalizedCode) {

        throw new Error(
            "Completion code is required when marking an order as paid."
        );

    }


    const completionCodeHash =
        hashCompletionCode(
            normalizedCode
        );


    const now =
        FieldValue.serverTimestamp();


    /*
    =====================================================
    ATOMIC UPDATE
    =====================================================
    */

    let processed =
        false;


    await db.runTransaction(
        async (transaction) => {

            const freshSnapshot =
                await transaction.get(
                    orderRef
                );


            if (!freshSnapshot.exists) {

                throw new Error(
                    "Order no longer exists."
                );

            }


            const freshOrder =
                freshSnapshot.data();


            /*
            ---------------------------------------------
            DUPLICATE PAYMENT PROTECTION
            ---------------------------------------------
            */

            if (
                freshOrder.paymentStatus ===
                PAYMENT_STATUS.COMPLETED
            ) {

                return;

            }


            /*
            ---------------------------------------------
            DO NOT PAY CANCELLED/REFUNDED ORDERS
            ---------------------------------------------
            */

            if (
                freshOrder.status ===
                ORDER_STATUS.CANCELLED
            ) {

                throw new Error(
                    "Cancelled order cannot be marked as paid."
                );

            }


            if (
                freshOrder.status ===
                ORDER_STATUS.REFUNDED
            ) {

                throw new Error(
                    "Refunded order cannot be marked as paid."
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

                    status:
                        ORDER_STATUS.PAID,

                    paymentStatus:
                        PAYMENT_STATUS.COMPLETED,

                    paymentId:
                        paymentId ||
                        freshOrder.paymentId ||
                        null,

                    paymentMethod:
                        paymentMethod,

                    providerTransactionId:
                        providerTransactionId ||
                        null,

                    /*
                    -------------------------------------
                    SELLER FUNDS
                    -------------------------------------
                    */

                    fundsReceived:
                        true,

                    fundsHeld:
                        true,

                    sellerPaymentStatus:
                        SELLER_PAYMENT_STATUS.HELD,

                    payoutStatus:
                        PAYOUT_STATUS.NOT_RELEASED,

                    /*
                    -------------------------------------
                    COMPLETION CODE
                    -------------------------------------
                    */

                    orderCompletionCodeHash:
                        completionCodeHash,

                    orderCompletionCodeStatus:
                        "ACTIVE",

                    orderCompletionCodeCreatedAt:
                        now,

                    /*
                    -------------------------------------
                    COMPLETION
                    -------------------------------------
                    */

                    orderCompletedAt:
                        null,

                    completedBy:
                        null,

                    /*
                    -------------------------------------
                    PAYMENT TIMESTAMP
                    -------------------------------------
                    */

                    paymentCompletedAt:
                        now,

                    updatedAt:
                        now,

                }

            );


            processed =
                true;

        }
    );


    /*
    =====================================================
    IF ANOTHER CALLBACK ALREADY PROCESSED PAYMENT
    =====================================================
    */

    if (!processed) {

        return {

            success:
                true,

            alreadyPaid:
                true,

            orderId,

            completionCode:
                null,

            message:
                "Payment was already processed.",

        };

    }


    /*
    =====================================================
    RETURN RESULT
    =====================================================

    IMPORTANT:

    The plain completion code is returned ONLY to the
    caller.

    It must NEVER be stored in Firestore.
    =====================================================
    */

    return {

        success:
            true,

        alreadyPaid:
            false,

        orderId,

        paymentId:
            paymentId ||
            null,

        providerTransactionId:
            providerTransactionId ||
            null,

        amount:
            receivedAmount,

        status:
            ORDER_STATUS.PAID,

        paymentStatus:
            PAYMENT_STATUS.COMPLETED,

        sellerPaymentStatus:
            SELLER_PAYMENT_STATUS.HELD,

        payoutStatus:
            PAYOUT_STATUS.NOT_RELEASED,

        completionCode:
            normalizedCode,

        message:
            "Payment successful. Give the completion code to the buyer. The buyer should share it with the seller only after successful delivery.",

    };

}


/*
=========================================================
COMPLETE ORDER WITH BUYER COMPLETION CODE
=========================================================

SELLER FLOW

Seller
   ↓
orderId + completionCode
   ↓
sellerAuth
   ↓
verify seller
   ↓
verify payment
   ↓
verify code
   ↓
ORDER COMPLETED
   ↓
SETTLEMENT SERVICE
   ↓
seller funds released

IMPORTANT:

This function does NOT directly credit the wallet.

The settlement service should perform the financial
release after the order has been atomically completed.
=========================================================
*/

async function completeOrderWithCode({

    orderId,

    sellerId,

    completionCode,

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


    const normalizedCode =
        normalizeCompletionCode(
            completionCode
        );


    if (
        !normalizedCode
    ) {

        throw new Error(
            "Order completion code is required."
        );

    }


    const orderRef =
        db
            .collection(
                COLLECTIONS.ORDERS
            )
            .doc(orderId);


    /*
    =====================================================
    READ ORDER
    =====================================================
    */

    const orderSnapshot =
        await orderRef.get();


    if (!orderSnapshot.exists) {

        throw new Error(
            "Order not found."
        );

    }


    const order =
        orderSnapshot.data();


    /*
    =====================================================
    VERIFY SELLER
    =====================================================
    */

    await verifySeller({

        order,

        sellerId,

    });


    /*
    =====================================================
    PAYMENT CHECK
    =====================================================
    */

    if (
        order.paymentStatus !==
        PAYMENT_STATUS.COMPLETED
    ) {

        throw new Error(
            "This order has not been successfully paid."
        );

    }


    /*
    =====================================================
    ORDER STATUS CHECK
    =====================================================
    */

    if (
        order.status ===
        ORDER_STATUS.COMPLETED
    ) {

        throw new Error(
            "This order has already been completed."
        );

    }


    /*
    =====================================================
    CODE STATUS CHECK
    =====================================================
    */

    if (
        order.orderCompletionCodeStatus !==
        "ACTIVE"
    ) {

        throw new Error(
            "This order completion code is no longer active."
        );

    }


    /*
    =====================================================
    HASH CHECK
    =====================================================
    */

    if (
        !order.orderCompletionCodeHash
    ) {

        throw new Error(
            "This order does not have a valid completion code."
        );

    }


    /*
    =====================================================
    VERIFY COMPLETION CODE
    =====================================================
    */

    const valid =
        verifyCompletionCode(

            normalizedCode,

            order.orderCompletionCodeHash

        );


    if (!valid) {

        throw new Error(
            "Invalid order completion code."
        );

    }

 /*
    =====================================================
    ATOMIC COMPLETION
    =====================================================
    */

    const now =
        FieldValue.serverTimestamp();


    await db.runTransaction(
        async (transaction) => {

            const freshSnapshot =
                await transaction.get(
                    orderRef
                );


            if (!freshSnapshot.exists) {

                throw new Error(
                    "Order no longer exists."
                );

            }


            const freshOrder =
                freshSnapshot.data();


            /*
            ---------------------------------------------
            RE-CHECK SELLER
            ---------------------------------------------
            */

            const sellerAuthorized =
                freshOrder.sellerId === sellerId ||
                (
                    Array.isArray(
                        freshOrder.items
                    ) &&
                    freshOrder.items.some(
                        item =>
                            item.sellerId ===
                            sellerId
                    )
                );


            if (!sellerAuthorized) {

                throw new Error(
                    "You are not authorized to complete this order."
                );

            }


            /*
            ---------------------------------------------
            RE-CHECK PAYMENT
            ---------------------------------------------
            */

            if (
                freshOrder.paymentStatus !==
                PAYMENT_STATUS.COMPLETED
            ) {

                throw new Error(
                    "Payment is not completed."
                );

            }


            /*
            ---------------------------------------------
            RE-CHECK ORDER
            ---------------------------------------------
            */

            if (
                freshOrder.status ===
                ORDER_STATUS.COMPLETED
            ) {

                throw new Error(
                    "Order has already been completed."
                );

            }


            /*
            ---------------------------------------------
            RE-CHECK CODE
            ---------------------------------------------
            */

            if (
                freshOrder.orderCompletionCodeStatus !==
                "ACTIVE"
            ) {

                throw new Error(
                    "Completion code is no longer active."
                );

            }


            /*
            ---------------------------------------------
            COMPLETE ORDER
            ---------------------------------------------
            */

            transaction.update(
                orderRef,
                {

                    status:
                        ORDER_STATUS.COMPLETED,

                    orderCompletionCodeStatus:
                        "USED",

                    orderCompletedAt:
                        now,

                    completedBy:
                        sellerId,

                    /*
                    -------------------------------------
                    SELLER FUNDS

                    We mark them ready for settlement.

                    settlementService performs the actual
                    financial release.
                    -------------------------------------
                    */

                    sellerPaymentStatus:
                        SELLER_PAYMENT_STATUS.RELEASED,

                    payoutStatus:
                        PAYOUT_STATUS.PENDING,

                    fundsHeld:
                        false,

                    fundsReceived:
                        true,

                    updatedAt:
                        now,

                }

            );

        }
    );


    /*
    =====================================================
    RETURN RESULT
    =====================================================
    */

    return {

        success:
            true,

        orderId,

        status:
            ORDER_STATUS.COMPLETED,

        completionCodeStatus:
            "USED",

        sellerPaymentStatus:
            SELLER_PAYMENT_STATUS.RELEASED,

        payoutStatus:
            PAYOUT_STATUS.PENDING,

        completedBy:
            sellerId,

        message:
            "Order completed successfully. Seller settlement can now proceed.",

    };

}


/*
=========================================================
GET BUYER ORDER
=========================================================
*/

async function getBuyerOrder({

    orderId,

    buyerId,

}) {

    const order =
        await getOrder(
            orderId
        );


    if (!order) {

        throw new Error(
            "Order not found."
        );

    }


    await verifyBuyer({

        order,

        buyerId,

    });


    return order;

}


/*
=========================================================
GET SELLER ORDER
=========================================================
*/

async function getSellerOrder({

    orderId,

    sellerId,

}) {

    const order =
        await getOrder(
            orderId
        );


    if (!order) {

        throw new Error(
            "Order not found."
        );

    }


    await verifySeller({

        order,

        sellerId,

    });


    return order;

}


/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

    getOrder,

    getBuyerOrder,

    getSellerOrder,

    verifyBuyer,

    verifySeller,

    markPaymentInitiated,

    markOrderPaid,

    completeOrderWithCode,

};