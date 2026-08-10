const {
    db
} = require("../config/firebase");


/*
=========================================================
MARKETPLACE PAYMENT SERVICE
=========================================================

Marketplace collections:

marketplaceOrders
marketplacePayments
marketplaceTransactions

Products/listings:

products/{listingId}

IMPORTANT:

- Buyer UID comes from Firebase Auth.
- Seller UID comes from products.userId.
- Product document ID is the listingId.
- Amount is ALWAYS taken from marketplaceOrders.
- Frontend amount is NEVER trusted.
- Stock is NOT reduced when order is created.
- Stock is reduced only after successful payment.
=========================================================
*/


/*
=========================================================
INTASEND
=========================================================
*/

let collection;

try {

    const IntaSend =
        require("intasend-node");

    const intasend =
        new IntaSend(
            process.env.INTASEND_PUBLISHABLE_KEY,
            process.env.INTASEND_SECRET_KEY,
            process.env.INTASEND_TEST_MODE === "true"
        );

    collection =
        intasend.collection;

} catch (error) {

    console.error(
        "❌ Failed to initialize IntaSend:",
        error
    );

}


/*
=========================================================
HELPERS
=========================================================
*/

function normalizePhone(phone) {

    if (!phone) {
        return "";
    }

    let value =
        String(phone)
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

    if (
        value === "MPESA"
    ) {

        return "MPESA";

    }

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


/*
=========================================================
INITIATE MARKETPLACE PAYMENT
=========================================================

This is called AFTER the marketplace order has already
been created.

The backend:

1. Gets marketplace order
2. Verifies buyer
3. Verifies order status
4. Gets authoritative order amount
5. Gets buyer phone
6. Initiates M-PESA STK
7. Saves payment attempt
8. Returns payment information

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


    /*
    Currently BIASHNET uses M-PESA.
    */

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
    VERIFY ORDER STATUS
    =====================================================
    */

    if (
        order.paymentStatus ===
        "COMPLETED"
    ) {

        throw new Error(
            "This order has already been paid."
        );

    }


    if (
        order.status !==
            "PENDING_PAYMENT" &&
        order.status !==
            "PAYMENT_INITIATED"
    ) {

        throw new Error(
            `This order cannot be paid. Current status: ${order.status}.`
        );

    }


    /*
    =====================================================
    GET AUTHORITATIVE AMOUNT
    =====================================================
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
    IDEMPOTENCY
    =====================================================

    If there is already an active payment request,
    don't create another one unnecessarily.
    =====================================================
    */

    const existingPaymentSnap =
        await paymentRef.get();


    if (
        existingPaymentSnap.exists
    ) {

        const existingPayment =
            existingPaymentSnap.data();


        if (
            existingPayment.status ===
                "PENDING" ||
            existingPayment.status ===
                "PROCESSING"
        ) {

            return {

                success: true,

                alreadyInitiated: true,

                paymentId,

                orderId,

                amount,

                phone,

                status:
                    existingPayment.status,

                checkoutRequestId:
                    existingPayment
                        .checkoutRequestId ||
                    null,

                merchantRequestId:
                    existingPayment
                        .merchantRequestId ||
                    null,

            };

        }

    }


    /*
    =====================================================
    INTASEND
    =====================================================
    */

    if (!collection) {

        throw new Error(
            "M-PESA payment service is not initialized."
        );

    }


    let paymentResponse;


    try {

        /*
        -------------------------------------------------
        INTASEND COLLECTION REQUEST
        -------------------------------------------------

        Adjust only this small IntaSend call if your
        installed IntaSend SDK version exposes a
        different method signature.
        -------------------------------------------------
        */

        paymentResponse =
            await collection.charge({

                first_name:
                    order.buyerName ||
                    "BIASHNET",

                last_name:
                    "Buyer",

                email:
                    order.buyerEmail ||
                    "buyer@biashnet.com",

                host:
                    process.env.CALLBACK_URL,

                amount,

                currency:
                    "KES",

                phone_number:
                    phone,

                api_ref:
                    orderId,

            });

    } catch (error) {

        console.error(
            "❌ IntaSend M-PESA initiation error:",
            error
        );

        throw new Error(
            error?.message ||
            "Failed to initiate M-PESA payment."
        );

    }


    /*
    =====================================================
    EXTRACT PROVIDER INFORMATION
    =====================================================
    */

    const checkoutRequestId =
        paymentResponse?.checkout_request_id ||
        paymentResponse?.checkoutRequestId ||
        paymentResponse?.invoice?.checkout_request_id ||
        null;


    const merchantRequestId =
        paymentResponse?.merchant_request_id ||
        paymentResponse?.merchantRequestId ||
        null;


    const providerTransactionId =
        paymentResponse?.transaction_id ||
        paymentResponse?.transactionId ||
        null;


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
                        freshOrder.sellerId,

                    listingId:
                        freshOrder.listingId,

                    amount,

                    currency:
                        "KES",

                    method:
                        "MPESA",

                    provider:
                        "INTASEND",

                    phone,

                    status:
                        "PENDING",

                    checkoutRequestId,

                    merchantRequestId,

                    providerTransactionId,

                    providerResponse:
                        paymentResponse ||
                        null,

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
    RETURN
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
            "INTASEND",

        status:
            "PENDING",

        checkoutRequestId,

        merchantRequestId,

        providerTransactionId,

        message:
            "M-PESA payment request initiated successfully.",

    };

}


/*
=========================================================
PROCESS SUCCESSFUL MARKETPLACE PAYMENT
=========================================================

Called by the M-PESA/IntaSend callback.

IMPORTANT:

Stock is reduced HERE, not when the order is created.

Example:

Before payment:
stock = 1

After successful payment:
stock = 0

=========================================================
*/

async function processMarketplacePayment({

    orderId,

    providerTransactionId,

    amount,

    paymentMethod = "MPESA",

    providerResponse = null,

}) {

    if (!orderId) {

        throw new Error(
            "Order ID is required."
        );

    }


    if (!providerTransactionId) {

        throw new Error(
            "Provider transaction ID is required."
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


    const expectedAmount =
        Number(
            order.buyerTotal
        );


    /*
    =====================================================
    AMOUNT VERIFICATION
    =====================================================
    */

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
    CHECK DUPLICATE PROVIDER TRANSACTION
    =====================================================
    */

    const existingPaymentSnap =
        await db
            .collection(
                "marketplacePayments"
            )
            .where(
                "providerTransactionId",
                "==",
                providerTransactionId
            )
            .limit(1)
            .get();


    if (
        !existingPaymentSnap.empty
    ) {

        const existing =
            existingPaymentSnap
                .docs[0]
                .data();


        return {

            success: true,

            alreadyProcessed: true,

            orderId,

            paymentId:
                existing.paymentId,

            providerTransactionId,

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


    const transactionId =
        `SALE-${Date.now()}-` +
        Math.random()
            .toString(36)
            .substring(2, 8)
            .toUpperCase();


    const transactionRef =
        db
            .collection(
                "marketplaceTransactions"
            )
            .doc(transactionId);


    const productRef =
        db
            .collection("products")
            .doc(order.listingId);


    const now =
        new Date();


    /*
    =====================================================
    ATOMIC SUCCESSFUL PAYMENT
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


            /*
            ---------------------------------------------
            ALREADY PAID
            ---------------------------------------------
            */

            if (
                freshOrder.paymentStatus ===
                "COMPLETED"
            ) {

                return;

            }


            /*
            ---------------------------------------------
            GET PRODUCT
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
            CHECK CURRENT STOCK
            ---------------------------------------------
            */

            const currentStock =
                Number(
                    product.stock || 0
                );


            if (
                currentStock <
                Number(
                    freshOrder.quantity
                )
            ) {

                throw new Error(
                    "Insufficient stock to complete this payment."
                );

            }


            /*
            ---------------------------------------------
            REDUCE STOCK ONLY NOW
            ---------------------------------------------
            */

            transaction.update(
                productRef,
                {

                    stock:
                        currentStock -
                        Number(
                            freshOrder.quantity
                        ),

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

                    providerTransactionId,

                    paymentMethod:
                        "MPESA",

                    updatedAt:
                        now,

                }
            );


            /*
            ---------------------------------------------
            PAYMENT
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
                        freshOrder.sellerId,

                    listingId:
                        freshOrder.listingId,

                    amount:
                        paidAmount,

                    currency:
                        "KES",

                    method:
                        "MPESA",

                    provider:
                        "INTASEND",

                    providerTransactionId,

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
                        freshOrder.sellerId,

                    listingId:
                        freshOrder.listingId,

                    amount:
                        paidAmount,

                    currency:
                        "KES",

                    commissionRate:
                        freshOrder.commissionRate,

                    commissionAmount:
                        freshOrder.commissionAmount,

                    sellerGross:
                        freshOrder.sellerGross,

                    sellerNet:
                        freshOrder.sellerNet,

                    paymentMethod:
                        "MPESA",

                    providerTransactionId,

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
                order.commissionAmount || 0
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


module.exports = {

    initiateMarketplacePayment,

    processMarketplacePayment,

    getPayment,

};