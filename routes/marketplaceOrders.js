const express = require("express");
const router = express.Router();

const { getAuth } = require("firebase-admin/auth");

const { db } = require("../config/firebase");

const {
    createMarketplaceOrder,
        createCartOrder,
} = require("../services/orderService");

/*
=========================================================
AUTHENTICATION MIDDLEWARE
=========================================================

Firebase:

Frontend
   ↓
Firebase ID Token
   ↓
Authorization: Bearer TOKEN
   ↓
verifyIdToken()
   ↓
req.user.uid

NEVER accept buyerId from req.body.
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
            authorization.substring(7).trim();


        if (!token) {

            return res.status(401).json({

                success: false,

                message:
                    "Authentication token is missing.",

            });

        }


        const decodedToken =
            await getAuth().verifyIdToken(
                token
            );


        if (!decodedToken?.uid) {

            return res.status(401).json({

                success: false,

                message:
                    "Invalid authentication token.",

            });

        }


        /*
        ---------------------------------------------
        ATTACH AUTHENTICATED USER
        ---------------------------------------------
        */

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
VALIDATE PAYMENT METHOD
=========================================================
*/

function normalizePaymentMethod(
    paymentMethod
) {

    const method =
        String(
            paymentMethod || "MPESA"
        )
        .trim()
        .toUpperCase();


    const allowed = [

        "MPESA",

        "CARD",

        "WALLET",

    ];


    if (
        !allowed.includes(method)
    ) {

        throw new Error(
            "Unsupported payment method. Use MPESA, CARD or WALLET."
        );

    }


    return method;

}


/*
=========================================================
CREATE MARKETPLACE ORDER
=========================================================

POST

/api/marketplace/orders

IMPORTANT:

listingId = Firestore document ID from:

products/{listingId}

The route does NOT expect:

productId field inside Firestore.

=========================================================
*/
router.post(
    "/cart",
    authenticateUser,
    async (req, res) => {

        try {

            const result =
                await createCartOrder({

                    buyerId:
                        req.user.uid,

                    items:
                        req.body.items,

                    deliveryFee:
                        req.body.deliveryFee || 0,

                    paymentMethod:
                        req.body.paymentMethod || "MPESA",

                    buyerPhone:
                        req.body.buyerPhone,

                    deliveryLocation:
                        req.body.deliveryLocation,

                    deliveryNote:
                        req.body.deliveryNote,

                    pickupStation:
                        req.body.pickupStation,

                    doorDelivery:
                        req.body.doorDelivery,

                });


            return res.status(201).json({

                success: true,

                message:
                    "Cart order created successfully.",

                orderId:
                    result.orderId,

                paymentId:
                    result.paymentId,

                order:
                    result,

            });

        } catch (error) {

            console.error(
                "❌ Cart order creation error:",
                error
            );

            return res.status(400).json({

                success: false,

                message:
                    error.message ||
                    "Unable to create cart order.",

            });

        }

    }
);

router.get(
    "/buyer/my-orders",
    authenticateUser,
    async (req, res) => {
        // buyer orders
    }
);

router.get(
    "/seller/my-orders",
    authenticateUser,
    async (req, res) => {
        // seller orders
    }
);

router.get(
    "/:orderId",
    authenticateUser,
    async (req, res) => {
        // individual order
    }
);


router.post(
    "/",
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


            /*
            =============================================
            REQUEST DATA
            =============================================
            */

            const {

                listingId,

                quantity = 1,

                deliveryFee = 0,

                paymentMethod = "MPESA",

                buyerPhone = "",

                deliveryLocation = "",

                deliveryNote = "",

            } = req.body;


            /*
            =============================================
            LISTING ID
            =============================================
            */

            if (
                typeof listingId !== "string" ||
                !listingId.trim()
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Listing ID is required.",

                });

            }


            const cleanListingId =
                listingId.trim();


            /*
            =============================================
            QUANTITY
            =============================================
            */

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


            /*
            =============================================
            DELIVERY FEE
            =============================================
            */

            const parsedDeliveryFee =
                Number(
                    deliveryFee || 0
                );


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
            PAYMENT METHOD
            =============================================
            */

            let normalizedPaymentMethod;


            try {

                normalizedPaymentMethod =
                    normalizePaymentMethod(
                        paymentMethod
                    );

            } catch (error) {

                return res.status(400).json({

                    success: false,

                    message:
                        error.message,

                });

            }


            /*
            =============================================
            PHONE
            =============================================
            */

            const cleanBuyerPhone =
                String(
                    buyerPhone || ""
                ).trim();


            if (!cleanBuyerPhone) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Buyer phone number is required.",

                });

            }


            /*
            =============================================
            DELIVERY LOCATION
            =============================================
            */

            const cleanDeliveryLocation =
                String(
                    deliveryLocation || ""
                ).trim();


            if (!cleanDeliveryLocation) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Delivery location is required.",

                });

            }


            /*
            =============================================
            DELIVERY NOTE
            =============================================
            */

            const cleanDeliveryNote =
                String(
                    deliveryNote || ""
                ).trim();


            /*
            =============================================
            CREATE ORDER
            =============================================
            */

            const result =
                await createMarketplaceOrder({

                    /*
                    SECURITY:
                    buyerId comes ONLY from
                    Firebase authentication.
                    */

                    buyerId,


                    /*
                    products/{listingId}
                    */

                    listingId:
                        cleanListingId,


                    quantity:
                        parsedQuantity,


                    deliveryFee:
                        parsedDeliveryFee,


                    paymentMethod:
                        normalizedPaymentMethod,


                    buyerPhone:
                        cleanBuyerPhone,


                    deliveryLocation:
                        cleanDeliveryLocation,


                    deliveryNote:
                        cleanDeliveryNote,

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


                /*
                Convenient for CheckoutDialog
                */

                orderId:
                    result.orderId,

                paymentId:
                    result.paymentId,


                order:
                    result,

            });


        } catch (error) {

            console.error(
                "❌ Create marketplace order error:",
                error
            );


            /*
            =============================================
            KNOWN BUSINESS ERRORS
            =============================================
            */

            const message =
                error?.message ||
                "Failed to create marketplace order.";


            /*
            Most service validation errors
            are client/business errors.
            */

            return res.status(400).json({

                success: false,

                message,

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

MUST COME BEFORE /:orderId
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


            /*
            Firestore may require an index for:

            where(buyerId)
            +
            orderBy(createdAt)
            */

            if (
                error.code ===
                "failed-precondition"
            ) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Firestore requires an index for buyer orders.",

                    error:
                        error.message,

                });

            }


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


            if (
                error.code ===
                "failed-precondition"
            ) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Firestore requires an index for seller orders.",

                    error:
                        error.message,

                });

            }


            return res.status(500).json({

                success: false,

                message:
                    "Failed to retrieve seller orders.",

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

Only:

BUYER
or
SELLER

can access the order.

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


            if (
                !orderId ||
                !orderId.trim()
            ) {

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
                    .doc(
                        orderId.trim()
                    );


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


module.exports = router;