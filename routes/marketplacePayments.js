const express = require("express");

const router =
    express.Router();

const {
    getAuth,
} = require("firebase-admin/auth");

const {
    db,
} = require("../config/firebase");

const {
    initiateMarketplacePayment,
    getPayment,
} = require(
    "../services/marketplacePayment"
);


/*
=========================================================
AUTHENTICATION
=========================================================
*/

async function authenticateUser(
    req,
    res,
    next
) {

    try {

        const authorization =
            req.headers.authorization;


        if (
            !authorization ||
            !authorization.startsWith(
                "Bearer "
            )
        ) {

            return res.status(401).json({

                success: false,

                message:
                    "Authentication required.",

            });

        }


        const token =
            authorization.substring(
                7
            );


        if (!token) {

            return res.status(401).json({

                success: false,

                message:
                    "Authentication token is missing.",

            });

        }


        const decodedToken =
            await getAuth()
                .verifyIdToken(
                    token
                );


        req.user =
            decodedToken;


        next();


    } catch (error) {

        console.error(
            "Marketplace payment authentication error:",
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

BODY:

{
    orderId,
    phone,
    paymentMethod
}

IMPORTANT:

buyerId is NEVER accepted from frontend.

It comes from:

req.user.uid

=========================================================
*/

router.post(
    "/initiate",
    authenticateUser,
    async (req, res) => {

        try {

            /*
            =============================================
            BUYER
            =============================================
            */

            const buyerId =
                req.user.uid;


            const {

                orderId,

                phone,

                phoneNumber,

                paymentMethod =
                    "MPESA",

            } = req.body;


            /*
            =============================================
            PHONE COMPATIBILITY
            =============================================
            */

            const buyerPhone =
                phone ||
                phoneNumber;


            /*
            =============================================
            VALIDATION
            =============================================
            */

            if (!orderId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Order ID is required.",

                });

            }


            if (!buyerPhone) {

                return res.status(400).json({

                    success: false,

                    message:
                        "M-PESA phone number is required.",

                });

            }


            /*
            =============================================
            PAYMENT METHOD
            =============================================
            */

            const normalizedPaymentMethod =
                String(
                    paymentMethod ||
                    "MPESA"
                )
                    .trim()
                    .toUpperCase()
                    .replace("-", "");


            if (
                normalizedPaymentMethod !==
                "MPESA"
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Currently only M-PESA payments are supported.",

                });

            }


            /*
            =============================================
            INITIATE
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
            RESPONSE
            =============================================
            */

            return res.status(200).json({

                success: true,

                message:
                    "M-PESA payment initiated successfully.",

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
                    "Failed to initiate marketplace payment.",

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

Only the buyer or seller belonging to the payment
can view it.
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


            if (!paymentId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Payment ID is required.",

                });

            }


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
            AUTHORIZATION
            =============================================
            */

            const currentUser =
                req.user.uid;


            if (
                payment.buyerId !==
                    currentUser &&
                payment.sellerId !==
                    currentUser
            ) {

                return res.status(403).json({

                    success: false,

                    message:
                        "You are not authorized to view this payment.",

                });

            }


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