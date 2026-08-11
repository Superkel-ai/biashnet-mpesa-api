const express = require("express");

const router = express.Router();

const {
    getAuth,
} = require("firebase-admin/auth");

const {
    initiateMarketplacePayment,
    getPayment,
} = require("../services/paymentService");


/*
=========================================================
AUTHENTICATION
=========================================================

Every marketplace payment request must come from an
authenticated Firebase user.

The buyer ID is NEVER accepted from the frontend.

It comes from:

    req.user.uid

=========================================================
*/

async function authenticateUser(req, res, next) {

    try {

        const authorization =
            req.headers.authorization;


        if (
            !authorization ||
            !authorization.startsWith("Bearer ")
        ) {

            return res.status(401).json({

                success: false,

                message:
                    "Authentication required.",

            });

        }


        const token =
            authorization.substring(7);


        if (!token) {

            return res.status(401).json({

                success: false,

                message:
                    "Authentication token is missing.",

            });

        }


        const decodedToken =
            await getAuth()
                .verifyIdToken(token);


        /*
        ---------------------------------------------
        STORE FIREBASE USER
        ---------------------------------------------
        */

        req.user =
            decodedToken;


        next();


    } catch (error) {

        console.error(
            "❌ Marketplace payment authentication error:",
            error
        );


        return res.status(401).json({

            success: false,

            message:
                "Invalid or expired authentication token.",

        });

    }

}


/*
=========================================================
INITIATE MARKETPLACE PAYMENT
=========================================================

POST

/api/marketplace/payments/initiate


FRONTEND BODY:

{
    orderId,
    phone,
    paymentMethod: "MPESA"
}


IMPORTANT:

buyerId is NOT sent by the frontend.

The backend gets it from:

    req.user.uid


The payment service then:

1. Finds the marketplace order
2. Verifies the buyer
3. Verifies the order status
4. Gets the real order amount
5. Initiates IntaSend M-PESA
6. Creates marketplacePayments record
7. Updates marketplaceOrders
8. Returns payment information

=========================================================
*/

router.post(
    "/initiate",
    authenticateUser,
    async (req, res) => {

        try {

            /*
            =============================================
            BUYER ID
            =============================================
            */

            const buyerId =
                req.user.uid;


            /*
            =============================================
            REQUEST BODY
            =============================================
            */

            const {

                orderId,

                phone,

                phoneNumber,

                paymentMethod = "MPESA",

            } = req.body;


            /*
            =============================================
            PHONE
            =============================================
            */

            const buyerPhone =
                phone ||
                phoneNumber;


            /*
            =============================================
            VALIDATE ORDER ID
            =============================================
            */

            if (!orderId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Order ID is required.",

                });

            }


            /*
            =============================================
            VALIDATE PHONE
            =============================================
            */

            if (!buyerPhone) {

                return res.status(400).json({

                    success: false,

                    message:
                        "M-PESA phone number is required.",

                });

            }


            /*
            =============================================
            NORMALIZE PAYMENT METHOD
            =============================================
            */

            const normalizedPaymentMethod =
                String(
                    paymentMethod || "MPESA"
                )
                    .trim()
                    .toUpperCase()
                    .replace(/[\s-]/g, "");


            /*
            =============================================
            CURRENTLY ONLY MPESA
            =============================================
            */

            if (
                normalizedPaymentMethod !== "MPESA"
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Currently only M-PESA payments are supported.",

                });

            }


            /*
            =============================================
            INITIATE PAYMENT
            =============================================
            */

            const result =
                await initiateMarketplacePayment({

                    orderId,

                    buyerId,

                    phoneNumber:
                        buyerPhone,

                    paymentMethod:
                        "MPESA",

                });


            /*
            =============================================
            SUCCESS RESPONSE
            =============================================
            */

            return res.status(200).json({

                success: true,

                message:
                    "M-PESA payment request initiated successfully.",

                payment:
                    result,

            });


        } catch (error) {

            console.error(
                "❌ Marketplace payment initiation error:",
                error
            );


            return res.status(400).json({

                success: false,

                message:
                    error?.message ||
                    "Failed to initiate M-PESA payment.",

            });

        }

    }
);


/*
=========================================================
GET MARKETPLACE PAYMENT
=========================================================

GET

/api/marketplace/payments/:paymentId

Only:

- buyer
- seller

can view the payment.

=========================================================
*/

router.get(
    "/:paymentId",
    authenticateUser,
    async (req, res) => {

        try {

            const {
                paymentId
            } = req.params;


            /*
            =============================================
            VALIDATE PAYMENT ID
            =============================================
            */

            if (!paymentId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Payment ID is required.",

                });

            }


            /*
            =============================================
            GET PAYMENT
            =============================================
            */

            const payment =
                await getPayment(
                    paymentId
                );


            if (!payment) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Marketplace payment not found.",

                });

            }


            /*
            =============================================
            CURRENT USER
            =============================================
            */

            const currentUserId =
                req.user.uid;


            /*
            =============================================
            AUTHORIZATION
            =============================================
            */

            if (
                payment.buyerId !==
                    currentUserId &&
                payment.sellerId !==
                    currentUserId
            ) {

                return res.status(403).json({

                    success: false,

                    message:
                        "You are not authorized to view this payment.",

                });

            }


            /*
            =============================================
            SUCCESS
            =============================================
            */

            return res.status(200).json({

                success: true,

                payment,

            });


        } catch (error) {

            console.error(
                "❌ Get marketplace payment error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    "Failed to retrieve marketplace payment.",

            });

        }

    }
);


module.exports = router;