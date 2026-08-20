const {
    initiateMarketplacePayment
} = require("../service/paymentInitiationService");


/*
=========================================================
PAYMENT CONTROLLER
=========================================================

Responsibilities:

- Receive HTTP request
- Get authenticated user from req.user
- Validate request-level data
- Pass clean data to payment service
- Return service result

IMPORTANT:

The controller does NOT:

- talk directly to Firestore
- talk directly to M-Pesa
- calculate commissions
- decide seller
- trust buyerId from frontend

Those responsibilities belong to services.
=========================================================
*/


/*
=========================================================
INITIATE MARKETPLACE PAYMENT
=========================================================
*/

async function initiatePayment(req, res) {

    try {

        /*
        =================================================
        GET AUTHENTICATED USER
        =================================================

        requireAuth middleware has already verified
        the Firebase ID token.

        Therefore:

        req.user.uid

        is the trusted buyer ID.
        =================================================
        */

        const buyerId =
            req.user?.uid;


        if (!buyerId) {

            return res.status(401).json({

                success: false,

                message:
                    "Authenticated user not found."

            });

        }


        /*
        =================================================
        READ REQUEST BODY
        =================================================
        */

        const {
            orderId,
            phoneNumber,
            paymentMethod
        } = req.body;


        /*
        =================================================
        BASIC VALIDATION
        =================================================
        */

        if (!orderId) {

            return res.status(400).json({

                success: false,

                message:
                    "Order ID is required."

            });

        }


        /*
        =================================================
        CALL PAYMENT INITIATION SERVICE
        =================================================

        Notice:

        buyerId comes from Firebase authentication.

        We DO NOT accept:

        req.body.buyerId
        =================================================
        */

        const result =
            await initiateMarketplacePayment({

                orderId,

                buyerId,

                phoneNumber,

                paymentMethod:
                    paymentMethod || "MPESA"

            });


        /*
        =================================================
        SUCCESS RESPONSE
        =================================================
        */

        return res.status(200).json({

            success: true,

            ...result

        });


    } catch (error) {

        console.error(
            "❌ Payment controller error:",
            error
        );


        /*
        =================================================
        HANDLE EXPECTED BUSINESS ERRORS
        =================================================
        */

        return res.status(400).json({

            success: false,

            message:
                error.message ||
                "Unable to initiate payment."

        });

    }

}


module.exports = {

    initiatePayment

};