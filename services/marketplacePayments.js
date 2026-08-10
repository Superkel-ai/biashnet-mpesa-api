const { db } = require("../config/firebase");

const {
    calculateMarketplaceCommission
} = require("./marketplaceCommission");

const {
    creditSellerPendingBalance
} = require("./marketplaceSellerWallet");


/*
=========================================================
 PAYMENT CALLBACK → ORDER CONFIRMATION
=========================================================
*/

async function confirmMarketplacePayment({
    orderId,
    paymentId,
    providerReference,
    amount,
    providerStatus,
}) {

    if (!orderId) {
        throw new Error("Order ID is required");
    }

    if (!paymentId) {
        throw new Error("Payment ID is required");
    }


    /*
    =========================================
    ONLY SUCCESSFUL PAYMENTS
    =========================================
    */

    const successfulStatuses = [
        "SUCCESS",
        "COMPLETED",
        "PAID",
        "SUCCESSFUL"
    ];


    if (
        !successfulStatuses.includes(
            String(providerStatus)
                .toUpperCase()
        )
    ) {

        throw new Error(
            "Payment was not successful"
        );

    }


    /*
    =========================================
    GET ORDER
    =========================================
    */

    const orderRef =
        db.collection("marketplaceOrders")
          .doc(orderId);


    const orderSnap =
        await orderRef.get();


    if (!orderSnap.exists) {
        throw new Error(
            "Marketplace order not found"
        );
    }


    const order =
        orderSnap.data();


    /*
    =========================================
    IDEMPOTENCY
    =========================================
    */

    if (
        order.paymentStatus === "PAID"
    ) {

        return {

            alreadyConfirmed: true,

            orderId,

            message:
                "Payment was already confirmed."

        };

    }


    /*
    =========================================
    VERIFY AMOUNT
    =========================================
    */

    const expectedAmount =
        Number(order.totalAmount || 0);


    const paidAmount =
        Number(amount);


    if (
        !Number.isFinite(paidAmount) ||
        paidAmount <= 0
    ) {

        throw new Error(
            "Invalid payment amount"
        );

    }


    if (
        Math.abs(
            expectedAmount -
            paidAmount
        ) > 0.01
    ) {

        throw new Error(
            "Payment amount does not match order amount"
        );

    }


    /*
    =========================================
    CALCULATE COMMISSION
    =========================================
    */

    const commission =
        calculateMarketplaceCommission({
            category:
                order.category,

            amount:
                paidAmount,
        });


    const sellerAmount =
        paidAmount -
        commission;


    /*
    =========================================
    UPDATE PAYMENT + ORDER
    =========================================
    */

    const paymentRef =
        db.collection(
            "marketplacePayments"
        )
        .doc(paymentId);


    const paymentSnap =
        await paymentRef.get();


    if (paymentSnap.exists) {

        const existingPayment =
            paymentSnap.data();

        if (
            existingPayment.status ===
            "COMPLETED"
        ) {

            return {

                alreadyConfirmed: true,

                orderId,

                paymentId,

            };

        }

    }


    /*
    =========================================
    CREATE PAYMENT RECORD
    =========================================
    */

    await paymentRef.set({

        paymentId,

        orderId,

        buyerId:
            order.buyerId,

        sellerId:
            order.sellerId,

        amount:
            paidAmount,

        commissionAmount:
            commission,

        sellerAmount,

        providerReference:
            providerReference || null,

        status:
            "COMPLETED",

        createdAt:
            new Date(),

        updatedAt:
            new Date(),

    }, {
        merge: true
    });


    /*
    =========================================
    CREDIT SELLER PENDING BALANCE
    =========================================
    */

    await creditSellerPendingBalance({

        sellerId:
            order.sellerId,

        orderId,

        paymentId,

        grossAmount:
            paidAmount,

        commissionAmount:
            commission,

        sellerAmount,

    });


    /*
    =========================================
    GENERATE DELIVERY CODE
    =========================================
    */

    const deliveryCode =
        generateDeliveryCode();


    /*
    =========================================
    UPDATE ORDER
    =========================================
    */

    await orderRef.update({

        paymentStatus:
            "PAID",

        status:
            "PAID",

        paymentId,

        providerReference:
            providerReference || null,

        paidAmount,

        commissionAmount:
            commission,

        sellerAmount,

        deliveryCode,

        deliveryCodeStatus:
            "ACTIVE",

        deliveryCodeCreatedAt:
            new Date(),

        updatedAt:
            new Date(),

    });


    return {

        success: true,

        orderId,

        paymentId,

        paidAmount,

        commissionAmount:
            commission,

        sellerAmount,

        deliveryCode,

    };
}


/*
=========================================================
 DELIVERY CODE
=========================================================

Use a random 6-digit code.

The code should be sent to the BUYER after payment.

Do NOT expose it to the seller automatically.
*/
const crypto = require("crypto");
    function generateDeliveryCode() {
    return crypto
        .randomInt(100000, 1000000)
        .toString();
}


module.exports = {

    confirmMarketplacePayment,

    generateDeliveryCode,

};