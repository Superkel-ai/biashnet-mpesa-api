const {
    db
} = require("../config/firebase");

const {
    stkPush
} = require("./mpesa");


/*
=========================================================
MARKETPLACE PAYMENT SERVICE
=========================================================

LOW LEVEL M-PESA:
services/mpesa.js

THIS SERVICE:
- validates marketplace order
- validates buyer
- gets authoritative amount
- initiates STK Push
- records payment attempt
- processes successful callback
- reduces stock
- creates marketplace transaction

Collections:

marketplaceOrders
marketplacePayments
marketplaceTransactions
products
=========================================================
*/


/*
=========================================================
HELPERS
=========================================================
*/

function normalizePhone(phone) {

    if (!phone) {
        return "";
    }

    let value = String(phone)
        .trim()
        .replace(/\s+/g, "");


    /*
    0712345678
    ->
    254712345678
    */

    if (
        value.startsWith("0") &&
        value.length === 10
    ) {

        value =
            "254" +
            value.substring(1);

    }


    /*
    +254712345678
    ->
    254712345678
    */

    if (
        value.startsWith("+254")
    ) {

        value =
            value.substring(1);

    }


    return value;
}



function normalizePaymentMethod(method) {

    const value =
        String(method || "MPESA")
            .trim()
            .toUpperCase()
            .replace("-", "");


    return value;
}



function generatePaymentId() {

    return (
        `PAY-${Date.now()}-` +
        Math.random()
            .toString(36)
            .substring(2, 8)
            .toUpperCase()
    );

}



function generateMarketplaceTransactionId() {

    return (
        `SALE-${Date.now()}-` +
        Math.random()
            .toString(36)
            .substring(2, 8)
            .toUpperCase()
    );

}



/*
=========================================================
INITIATE MARKETPLACE PAYMENT
=========================================================

Called by:

POST /api/marketplace/payments/initiate

IMPORTANT:

The frontend DOES NOT provide amount.

Amount comes from:

marketplaceOrders/{orderId}.buyerTotal

=========================================================
*/

async function initiateMarketplacePayment({

    orderId,

    buyerId,

    phoneNumber,

    paymentMethod = "MPESA",

}) {

    /*
    =====================================================
    VALIDATION
    =====================================================
    */

    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }


    if (!buyerId) {

        throw new Error(
            "Buyer ID is required."
        );

    }


    const normalizedMethod =
        normalizePaymentMethod(
            paymentMethod
        );


    if (
        normalizedMethod !== "MPESA"
    ) {

        throw new Error(
            "Currently only M-PESA payments are supported."
        );

    }


    /*
    =====================================================
    GET ORDER
    =====================================================
    */

    const orderRef =
        db
            .collection("marketplaceOrders")
            .doc(orderId);


    const orderSnap =
        await orderRef.get();


    if (!orderSnap.exists) {

        throw new Error(
            "Marketplace order not found."
        );

    }


    const order =
        orderSnap.data();


    /*
    =====================================================
    VERIFY BUYER
    =====================================================
    */

    if (
        order.buyerId !== buyerId
    ) {

        throw new Error(
            "You are not authorized to pay for this order."
        );

    }


    /*
    =====================================================
    CHECK PAYMENT STATUS
    =====================================================
    */

    if (
        order.paymentStatus === "COMPLETED" ||
        order.paymentStatus === "PAID"
    ) {

        throw new Error(
            "This order has already been paid."
        );

    }


    /*
    =====================================================
    CHECK ORDER STATUS
    =====================================================
    */

    if (
        order.status !== "PENDING_PAYMENT" &&
        order.status !== "PAYMENT_INITIATED"
    ) {

        throw new Error(
            `This order cannot be paid. Current status: ${order.status}.`
        );

    }


    /*
    =====================================================
    AUTHORITATIVE AMOUNT
    =====================================================

    NEVER trust frontend amount.
    */

    const amount =
        Number(
            order.buyerTotal
        );


    if (
        !Number.isFinite(amount) ||
        amount <= 0
    ) {

        throw new Error(
            "Invalid marketplace order amount."
        );

    }


    /*
    =====================================================
    PHONE
    =====================================================
    */

    const phone =
        normalizePhone(
            phoneNumber ||
            order.buyerPhone
        );


    if (!phone) {

        throw new Error(
            "M-PESA phone number is required."
        );

    }


    if (
        !/^2547\d{8}$/.test(phone)
    ) {

        throw new Error(
            "Invalid Kenyan M-PESA phone number."
        );

    }


    /*
    =====================================================
    PAYMENT ID
    =====================================================
    */

    const paymentId =
        order.paymentId ||
        generatePaymentId();


    const paymentRef =
        db
            .collection(
                "marketplacePayments"
            )
            .doc(paymentId);


    /*
    =====================================================
    CHECK EXISTING PAYMENT
    =====================================================
    */

    const existingPaymentSnap =
        await paymentRef.get();


    if (
        existingPaymentSnap.exists
    ) {

        const existingPayment =
            existingPaymentSnap.data();


        /*
        If previous STK request is still pending,
        don't send another STK.
        */

        if (
            existingPayment.status === "PENDING" ||
            existingPayment.status === "PROCESSING"
        ) {

            return {

                success: true,

                alreadyInitiated: true,

                paymentId,

                orderId,

                amount,

                currency: "KES",

                phone,

                paymentMethod: "MPESA",

                status:
                    existingPayment.status,

                checkoutRequestID:
                    existingPayment.checkoutRequestID ||
                    null,

                merchantRequestID:
                    existingPayment.merchantRequestID ||
                    null,

                message:
                    "An M-PESA payment request is already pending."

            };

        }

    }


    /*
    =====================================================
    INITIATE M-PESA STK PUSH
    =====================================================
    */

    let mpesaResponse;


    try {

        mpesaResponse =
            await stkPush(
                phone,
                amount,
                `ORDER-${orderId.slice(0, 8)}`
            );


    } catch (error) {

        console.error(
            "❌ Marketplace M-PESA STK error:",
            error.response?.data ||
            error.message ||
            error
        );


        throw new Error(
            error.response?.data?.errorMessage ||
            error.response?.data?.errorCode ||
            error.message ||
            "Failed to initiate M-PESA STK Push."
        );

    }


    console.log(
        "✅ Marketplace M-PESA response:",
        JSON.stringify(
            mpesaResponse,
            null,
            2
        )
    );


    /*
    =====================================================
    VERIFY SAFARICOM RESPONSE
    =====================================================
    */

    if (
        String(
            mpesaResponse?.ResponseCode
        ) !== "0"
    ) {

        throw new Error(
            mpesaResponse?.ResponseDescription ||
            "M-PESA STK Push was rejected."
        );

    }


    /*
    =====================================================
    GET M-PESA IDS
    =====================================================
    */

    const checkoutRequestID =
        mpesaResponse.CheckoutRequestID;


    const merchantRequestID =
        mpesaResponse.MerchantRequestID;


    if (!checkoutRequestID) {

        throw new Error(
            "M-PESA did not return CheckoutRequestID."
        );

    }


    const now =
        new Date();


    /*
    =====================================================
    SAVE PAYMENT + UPDATE ORDER
    =====================================================
    */

    await db.runTransaction(
        async (transaction) => {

            const freshOrderSnap =
                await transaction.get(
                    orderRef
                );


            if (
                !freshOrderSnap.exists
            ) {

                throw new Error(
                    "Marketplace order no longer exists."
                );

            }


            const freshOrder =
                freshOrderSnap.data();


            if (
                freshOrder.buyerId !==
                buyerId
            ) {

                throw new Error(
                    "Order ownership verification failed."
                );

            }


            /*
            ---------------------------------------------
            PAYMENT RECORD
            ---------------------------------------------
            */

            transaction.set(
                paymentRef,
                {

                    paymentId,

                    orderId,

                    buyerId,

                    sellerId:
                        freshOrder.sellerId ||
                        null,

                    listingId:
                        freshOrder.listingId ||
                        null,

                    amount,

                    currency:
                        "KES",

                    method:
                        "MPESA",

                    provider:
                        "MPESA",

                    phone,

                    status:
                        "PENDING",

                    checkoutRequestID,

                    merchantRequestID,

                    mpesaResponse,

                    createdAt:
                        now,

                    updatedAt:
                        now,

                },
                {
                    merge: true
                }
            );


            /*
            ---------------------------------------------
            UPDATE ORDER
            ---------------------------------------------
            */

            transaction.update(
                orderRef,
                {

                    paymentId,

                    paymentMethod:
                        "MPESA",

                    buyerPhone:
                        phone,

                    checkoutRequestID,

                    merchantRequestID,

                    status:
                        "PAYMENT_INITIATED",

                    paymentStatus:
                        "PENDING",

                    paymentInitiatedAt:
                        now,

                    updatedAt:
                        now,

                }
            );

        }
    );


    /*
    =====================================================
    RETURN TO FRONTEND
    =====================================================
    */

    return {

        success: true,

        alreadyInitiated: false,

        paymentId,

        orderId,

        amount,

        currency:
            "KES",

        phone,

        paymentMethod:
            "MPESA",

        provider:
            "MPESA",

        status:
            "PENDING",

        checkoutRequestID,

        merchantRequestID,

        message:
            mpesaResponse.CustomerMessage ||
            "M-PESA payment request sent. Check your phone.",

    };

}



/*
=========================================================
PROCESS SUCCESSFUL MARKETPLACE PAYMENT
=========================================================

THIS IS CALLED BY YOUR M-PESA CALLBACK.

Do NOT call this from the frontend.

Flow:

Safaricom
    ↓
CALLBACK_URL
    ↓
callback route
    ↓
processMarketplacePayment()
    ↓
verify amount
    ↓
reduce stock
    ↓
mark order paid
    ↓
create payment record
    ↓
create marketplace transaction

=========================================================
*/

async function processMarketplacePayment({

    orderId,

    checkoutRequestID,

    providerTransactionId,

    amount,

    receiptNumber,

    phoneNumber,

    providerResponse = null,

}) {

    /*
    =====================================================
    VALIDATION
    =====================================================
    */

    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }


    if (!providerTransactionId) {

        throw new Error(
            "M-PESA transaction ID is required."
        );

    }


    const paidAmount =
        Number(amount);


    if (
        !Number.isFinite(paidAmount) ||
        paidAmount <= 0
    ) {

        throw new Error(
            "Invalid payment amount."
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
                "marketplaceOrders"
            )
            .doc(orderId);


    const orderSnap =
        await orderRef.get();


    if (!orderSnap.exists) {

        throw new Error(
            "Marketplace order not found."
        );

    }


    const order =
        orderSnap.data();


    /*
    =====================================================
    VERIFY AMOUNT
    =====================================================
    */

    const expectedAmount =
        Number(
            order.buyerTotal
        );


    if (
        !Number.isFinite(expectedAmount) ||
        expectedAmount <= 0
    ) {

        throw new Error(
            "Invalid order amount."
        );

    }


    if (
        Math.abs(
            paidAmount -
            expectedAmount
        ) > 0.01
    ) {

        throw new Error(
            `Payment amount mismatch. Expected KES ${expectedAmount}, received KES ${paidAmount}.`
        );

    }


    /*
    =====================================================
    IDEMPOTENCY
    =====================================================
    */

    const existingTransactionSnap =
        await db
            .collection(
                "marketplaceTransactions"
            )
            .where(
                "providerTransactionId",
                "==",
                providerTransactionId
            )
            .limit(1)
            .get();


    if (
        !existingTransactionSnap.empty
    ) {

        const existing =
            existingTransactionSnap
                .docs[0]
                .data();


        return {

            success: true,

            alreadyProcessed: true,

            orderId,

            paymentId:
                existing.paymentId,

            transactionId:
                existing.transactionId,

            providerTransactionId,

            status:
                "PAID",

        };

    }


    /*
    =====================================================
    PAYMENT ID
    =====================================================
    */

    const paymentId =
        order.paymentId ||
        generatePaymentId();


    const paymentRef =
        db
            .collection(
                "marketplacePayments"
            )
            .doc(paymentId);


    /*
    =====================================================
    MARKETPLACE TRANSACTION
    =====================================================
    */

    const transactionId =
        generateMarketplaceTransactionId();


    const transactionRef =
        db
            .collection(
                "marketplaceTransactions"
            )
            .doc(transactionId);


    /*
    =====================================================
    PRODUCT
    =====================================================
    */

    const listingId =
        order.listingId;


    if (!listingId) {

        throw new Error(
            "Order listingId is missing."
        );

    }


    const productRef =
        db
            .collection("products")
            .doc(listingId);


    const now =
        new Date();


    /*
    =====================================================
    ATOMIC PAYMENT PROCESSING
    =====================================================
    */

    await db.runTransaction(
        async (transaction) => {

            /*
            IMPORTANT:
            All reads happen before writes.
            */

            const freshOrderSnap =
                await transaction.get(
                    orderRef
                );


            if (
                !freshOrderSnap.exists
            ) {

                throw new Error(
                    "Marketplace order no longer exists."
                );

            }


            const freshOrder =
                freshOrderSnap.data();


            /*
            ---------------------------------------------
            ALREADY PAID
            ---------------------------------------------
            */

            if (
                freshOrder.paymentStatus ===
                    "COMPLETED" ||
                freshOrder.paymentStatus ===
                    "PAID"
            ) {

                return;

            }


            /*
            ---------------------------------------------
            PRODUCT
            ---------------------------------------------
            */

            const productSnap =
                await transaction.get(
                    productRef
                );


            if (
                !productSnap.exists
            ) {

                throw new Error(
                    "Product no longer exists."
                );

            }


            const product =
                productSnap.data();


            /*
            ---------------------------------------------
            QUANTITY
            ---------------------------------------------
            */

            const quantity =
                Number(
                    freshOrder.quantity || 1
                );


            if (
                !Number.isInteger(quantity) ||
                quantity <= 0
            ) {

                throw new Error(
                    "Invalid order quantity."
                );

            }


            /*
            ---------------------------------------------
            STOCK
            ---------------------------------------------
            */

            const currentStock =
                Number(
                    product.stock || 0
                );


            if (
                currentStock < quantity
            ) {

                throw new Error(
                    "Insufficient stock to complete this payment."
                );

            }

            /*
            ---------------------------------------------
            REDUCE STOCK
            ---------------------------------------------
            */

            transaction.update(
                productRef,
                {

                    stock:
                        currentStock -
                        quantity,

                    updatedAt:
                        now,

                }
            );


            /*
            ---------------------------------------------
            UPDATE ORDER
            ---------------------------------------------
            */

            transaction.update(
                orderRef,
                {

                    status:
                        "PAID",

                    paymentStatus:
                        "COMPLETED",

                    paymentCompletedAt:
                        now,

                    provider:
                        "MPESA",

                    paymentMethod:
                        "MPESA",

                    providerTransactionId,

                    checkoutRequestID:
                        checkoutRequestID ||
                        freshOrder.checkoutRequestID ||
                        null,

                    mpesaReceiptNumber:
                        receiptNumber ||
                        null,

                    paidPhone:
                        phoneNumber ||
                        freshOrder.buyerPhone ||
                        null,

                    paidAmount,

                    updatedAt:
                        now,

                }
            );


            /*
            ---------------------------------------------
            PAYMENT RECORD
            ---------------------------------------------
            */

            transaction.set(
                paymentRef,
                {

                    paymentId,

                    orderId,

                    buyerId:
                        freshOrder.buyerId,

                    sellerId:
                        freshOrder.sellerId ||
                        null,

                    listingId:
                        freshOrder.listingId ||
                        null,

                    amount:
                        paidAmount,

                    currency:
                        "KES",

                    method:
                        "MPESA",

                    provider:
                        "MPESA",

                    phone:
                        phoneNumber ||
                        freshOrder.buyerPhone ||
                        null,

                    checkoutRequestID:
                        checkoutRequestID ||
                        freshOrder.checkoutRequestID ||
                        null,

                    providerTransactionId,

                    mpesaReceiptNumber:
                        receiptNumber ||
                        null,

                    status:
                        "COMPLETED",

                    providerResponse:
                        providerResponse ||
                        null,

                    completedAt:
                        now,

                    updatedAt:
                        now,

                },
                {
                    merge: true
                }
            );


            /*
            ---------------------------------------------
            FINANCIAL LEDGER
            ---------------------------------------------
            */

            transaction.set(
                transactionRef,
                {

                    transactionId,

                    type:
                        "MARKETPLACE_SALE",

                    orderId,

                    paymentId,

                    buyerId:
                        freshOrder.buyerId,

                    sellerId:
                        freshOrder.sellerId ||
                        null,

                    listingId:
                        freshOrder.listingId ||
                        null,

                    amount:
                        paidAmount,

                    currency:
                        "KES",

                    commissionRate:
                        Number(
                            freshOrder.commissionRate ||
                            0
                        ),

                    commissionAmount:
                        Number(
                            freshOrder.commissionAmount ||
                            0
                        ),

                    sellerGross:
                        Number(
                            freshOrder.sellerGross ||
                            0
                        ),

                    sellerNet:
                        Number(
                            freshOrder.sellerNet ||
                            0
                        ),

                    paymentMethod:
                        "MPESA",

                    provider:
                        "MPESA",

                    providerTransactionId,

                    mpesaReceiptNumber:
                        receiptNumber ||
                        null,

                    status:
                        "COMPLETED",

                    createdAt:
                        now,

                    updatedAt:
                        now,

                }
            );

        }
    );


    /*
    =====================================================
    RESULT
    =====================================================
    */

    return {

        success: true,

        alreadyProcessed: false,

        orderId,

        paymentId,

        transactionId,

        providerTransactionId,

        amount:
            paidAmount,

        commissionAmount:
            Number(
                freshOrder.commissionAmount || 0
            ),

        sellerAmount:
            Number(
                order.sellerNet || 0
            ),

        status:
            "PAID",

    };

}



/*
=========================================================
GET PAYMENT
=========================================================
*/

async function getPayment(paymentId) {

    if (!paymentId) {

        throw new Error(
            "Payment ID is required."
        );

    }


    const snap =
        await db
            .collection(
                "marketplacePayments"
            )
            .doc(paymentId)
            .get();


    if (!snap.exists) {

        return null;

    }


    return {

        id:
            snap.id,

        ...snap.data(),

    };

}



/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

    initiateMarketplacePayment,

    processMarketplacePayment,

    getPayment,

};
           