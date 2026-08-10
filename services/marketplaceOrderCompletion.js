const { db } = require("../config/firebase");

const {
    releaseSellerFunds
} = require("./marketplaceSellerWallet");


/*
=========================================================
 COMPLETE MARKETPLACE ORDER
=========================================================

Seller enters the delivery code provided by buyer.

Correct code:

Order → COMPLETED
Seller pending → available

Wrong code:

Nothing changes.
=========================================================
*/

async function completeMarketplaceOrder({
    orderId,
    sellerId,
    deliveryCode,
}) {

    if (!orderId) {
        throw new Error(
            "Order ID is required"
        );
    }

    if (!sellerId) {
        throw new Error(
            "Seller ID is required"
        );
    }

    if (!deliveryCode) {
        throw new Error(
            "Delivery code is required"
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
    VERIFY SELLER
    =========================================
    */

    if (
        order.sellerId !== sellerId
    ) {

        throw new Error(
            "You are not the seller for this order"
        );

    }


    /*
    =========================================
    VERIFY PAYMENT
    =========================================
    */

    if (
        order.paymentStatus !== "PAID"
    ) {

        throw new Error(
            "This order has not been paid"
        );

    }


    /*
    =========================================
    ALREADY COMPLETED
    =========================================
    */

    if (
        order.status === "COMPLETED"
    ) {

        return {

            success: true,

            alreadyCompleted: true,

            orderId,

            message:
                "Order has already been completed."

        };

    }


    /*
    =========================================
    VERIFY DELIVERY CODE
    =========================================
    */

    const submittedCode =
        String(deliveryCode)
            .trim();


    const storedCode =
        String(
            order.deliveryCode || ""
        )
        .trim();


    if (
        !storedCode ||
        submittedCode !== storedCode
    ) {

        /*
        -----------------------------------------
        RECORD FAILED ATTEMPT
        -----------------------------------------
        */

        await orderRef.update({

            deliveryCodeAttempts:
                Number(
                    order.deliveryCodeAttempts || 0
                ) + 1,

            lastDeliveryCodeAttemptAt:
                new Date(),

            updatedAt:
                new Date(),

        });


        throw new Error(
            "Invalid delivery confirmation code"
        );

    }


    /*
    =========================================
    RELEASE SELLER FUNDS
    =========================================
    */

    const release =
        await releaseSellerFunds({

            sellerId,

            orderId,

        });


    /*
    =========================================
    COMPLETE ORDER
    =========================================
    */

    await orderRef.update({

        status:
            "COMPLETED",

        deliveryCodeStatus:
            "USED",

        completedAt:
            new Date(),

        completedBy:
            sellerId,

        fundsReleased:
            true,

        updatedAt:
            new Date(),

    });


    return {

        success: true,

        alreadyCompleted: false,

        orderId,

        sellerId,

        releasedAmount:
            release.amount,

        message:
            "Order completed and seller funds released successfully."

    };

}


module.exports = {

    completeMarketplaceOrder,

};