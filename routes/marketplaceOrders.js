const express = require("express");
const router = express.Router();

const { getAuth } = require("firebase-admin/auth");

const { db } = require("../config/firebase");

const {
    createMarketplaceOrder,
} = require("../services/orderService");


/*
=========================================================
AUTHENTICATION MIDDLEWARE
=========================================================

The buyer ID MUST come from the Firebase ID token.

Never trust:

req.body.userId

because a malicious user could simply change it and
create an order under another user's account.
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
            authorization.split("Bearer ")[1];


        if (!token) {

            return res.status(401).json({

                success: false,

                message:
                    "Invalid authentication token.",

            });

        }


        const decodedToken =
            await getAuth().verifyIdToken(
                token
            );


        req.user = decodedToken;


        next();


    } catch (error) {

        console.error(
            "Marketplace authentication error:",
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
CREATE MARKETPLACE ORDER
=========================================================

POST

/api/marketplace/orders

The buyer ID is taken from the authenticated Firebase
user, NOT from the request body.

=========================================================
*/

router.post(
    "/",
    authenticateUser,
    async (req, res) => {

        try {

            const buyerId =
                req.user.uid;


            const {

                listingId,

                quantity = 1,

                deliveryFee = 0,

                paymentMethod = "MPESA",

            } = req.body;


            /*
            =============================================
            VALIDATION
            =============================================
            */

            if (!listingId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Listing ID is required.",

                });

            }


            const parsedQuantity =
                Number(quantity);


            if (
                !Number.isInteger(
                    parsedQuantity
                ) ||
                parsedQuantity <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Quantity must be a positive whole number.",

                });

            }


            const parsedDeliveryFee =
                Number(deliveryFee || 0);


            if (
                !Number.isFinite(
                    parsedDeliveryFee
                ) ||
                parsedDeliveryFee < 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid delivery fee.",

                });

            }


            /*
            =============================================
            ALLOWED PAYMENT METHODS
            =============================================
            */

            const allowedPaymentMethods = [

                "MPESA",

                "CARD",

                "BANK",

            ];


            const normalizedPaymentMethod =
                String(paymentMethod)
                    .trim()
                    .toUpperCase();


            if (
                !allowedPaymentMethods.includes(
                    normalizedPaymentMethod
                )
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Unsupported payment method.",

                });

            }


            /*
            =============================================
            CREATE ORDER
            =============================================
            */

            const result =
                await createMarketplaceOrder({

                    buyerId,

                    listingId,

                    quantity:
                        parsedQuantity,

                    deliveryFee:
                        parsedDeliveryFee,

                    paymentMethod:
                        normalizedPaymentMethod,

                });


            /*
            =============================================
            RESPONSE
            =============================================
            */

            return res.status(201).json({

                success: true,

                message:
                    "Marketplace order created successfully.",

                order: result,

            });


        } catch (error) {

            console.error(
                "❌ Create marketplace order error:",
                error
            );


            return res.status(400).json({

                success: false,

                message:
                    error.message ||
                    "Failed to create marketplace order.",

            });

        }

    }
);


/*
=========================================================
GET SINGLE ORDER
=========================================================

GET

/api/marketplace/orders/:orderId

Only the buyer or seller involved in the order can
retrieve it.

=========================================================
*/

router.get(
    "/:orderId",
    authenticateUser,
    async (req, res) => {

        try {

            const {
                orderId
            } = req.params;


            if (!orderId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Order ID is required.",

                });

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

                return res.status(404).json({

                    success: false,

                    message:
                        "Order not found.",

                });

            }


            const order =
                orderSnap.data();


            /*
            =============================================
            AUTHORIZATION
            =============================================
            */

            const currentUser =
                req.user.uid;


            const isBuyer =
                order.buyerId ===
                currentUser;


            const isSeller =
                order.sellerId ===
                currentUser;


            if (
                !isBuyer &&
                !isSeller
            ) {

                return res.status(403).json({

                    success: false,

                    message:
                        "You are not authorized to view this order.",

                });

            }


            return res.status(200).json({

                success: true,

                order: {

                    id:
                        orderSnap.id,

                    ...order,

                },

            });


        } catch (error) {

            console.error(
                "❌ Get marketplace order error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    "Failed to retrieve order.",

            });

        }

    }
);


/*
=========================================================
GET BUYER ORDERS
=========================================================

GET

/api/marketplace/orders/buyer/my-orders

The buyer ID comes from Firebase authentication.

=========================================================
*/

router.get(
    "/buyer/my-orders",
    authenticateUser,
    async (req, res) => {

        try {

            const buyerId =
                req.user.uid;


            const snapshot =
                await db
                    .collection(
                        "marketplaceOrders"
                    )
                    .where(
                        "buyerId",
                        "==",
                        buyerId
                    )
                    .orderBy(
                        "createdAt",
                        "desc"
                    )
                    .get();


            const orders =
                snapshot.docs.map(
                    (doc) => ({

                        id:
                            doc.id,

                        ...doc.data(),

                    })
                );


            return res.status(200).json({

                success: true,

                count:
                    orders.length,

                orders,

            });


        } catch (error) {

            console.error(
                "❌ Get buyer orders error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    "Failed to retrieve buyer orders.",

            });

        }

    }
);


/*
=========================================================
GET SELLER ORDERS
=========================================================

GET

/api/marketplace/orders/seller/my-orders

The seller ID comes from Firebase authentication.

=========================================================
*/

router.get(
    "/seller/my-orders",
    authenticateUser,
    async (req, res) => {

        try {

            const sellerId =
                req.user.uid;


            const snapshot =
                await db
                    .collection(
                        "marketplaceOrders"
                    )
                    .where(
                        "sellerId",
                        "==",
                        sellerId
                    )
                    .orderBy(
                        "createdAt",
                        "desc"
                    )
                    .get();


            const orders =
                snapshot.docs.map(
                    (doc) => ({

                        id:
                            doc.id,

                        ...doc.data(),

                    })
                );


            return res.status(200).json({

                success: true,

                count:
                    orders.length,

                orders,

            });


        } catch (error) {

            console.error(
                "❌ Get seller orders error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    "Failed to retrieve seller orders.",

            });

        }

    }
);


module.exports = router;