const {
    createOrder,
    getOrder,
    getBuyerOrders,
    getSellerOrders,
    cancelOrder,
} = require("../service/orderService");


/*
=========================================================
ORDER CONTROLLER
=========================================================

Responsibilities:

- Receive HTTP request
- Read authenticated user
- Validate request-level information
- Call orderService
- Return HTTP response

IMPORTANT:

The controller does NOT:

- directly access Firestore
- calculate order totals
- determine seller
- calculate commission
- manipulate stock
- process payments
- release seller funds

Those responsibilities belong to services.
=========================================================
*/


/*
=========================================================
CREATE ORDER
=========================================================

POST

/api/orders

Body example:

{
    "listingId": "abc123",
    "quantity": 2,
    "buyerPhone": "0712345678",
    "deliveryAddress": "...",
    "deliveryMethod": "PICKUP"
}

buyerId comes from Firebase Authentication.
=========================================================
*/

async function createOrderController(req, res) {

    try {

        const buyerId =
            req.user?.uid;


        if (!buyerId) {

            return res.status(401).json({

                success: false,

                message:
                    "Authenticated user not found."

            });

        }


        const {
            listingId,
            quantity,
            buyerPhone,
            deliveryAddress,
            deliveryMethod,
        } = req.body;


        if (!listingId) {

            return res.status(400).json({

                success: false,

                message:
                    "Listing ID is required."

            });

        }


        if (
            quantity === undefined ||
            quantity === null
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Quantity is required."

            });

        }


        const result =
            await createOrder({

                buyerId,

                listingId,

                quantity,

                buyerPhone,

                deliveryAddress,

                deliveryMethod,

            });


        return res.status(201).json({

            success: true,

            ...result,

        });


    } catch (error) {

        console.error(
            "❌ Create order controller error:",
            error
        );


        return res.status(400).json({

            success: false,

            message:
                error.message ||
                "Unable to create order.",

        });

    }

}


/*
=========================================================
GET SINGLE ORDER
=========================================================

GET

/api/orders/:orderId

Buyer or seller access should ultimately be
verified by orderService.
=========================================================
*/

async function getOrderController(req, res) {

    try {

        const userId =
            req.user?.uid;


        if (!userId) {

            return res.status(401).json({

                success: false,

                message:
                    "Authenticated user not found."

            });

        }


        const {
            orderId
        } = req.params;


        if (!orderId) {

            return res.status(400).json({

                success: false,

                message:
                    "Order ID is required."

            });

        }


        const order =
            await getOrder(
                orderId,
                userId
            );


        if (!order) {

            return res.status(404).json({

                success: false,

                message:
                    "Order not found."

            });

        }


        return res.status(200).json({

            success: true,

            order,

        });


    } catch (error) {

        console.error(
            "❌ Get order controller error:",
            error
        );


        return res.status(400).json({

            success: false,

            message:
                error.message ||
                "Unable to retrieve order.",

        });

    }

}


/*
=========================================================
GET BUYER ORDERS
=========================================================

GET

/api/orders/my
=========================================================
*/

async function getMyOrdersController(req, res) {

    try {

        const buyerId =
            req.user?.uid;


        if (!buyerId) {

            return res.status(401).json({

                success: false,

                message:
                    "Authenticated user not found."

            });

        }


        const orders =
            await getBuyerOrders(
                buyerId
            );


        return res.status(200).json({

            success: true,

            orders,

        });


    } catch (error) {

        console.error(
            "❌ Get buyer orders controller error:",
            error
        );


        return res.status(400).json({

            success: false,

            message:
                error.message ||
                "Unable to retrieve orders.",

        });

    }

}


/*
=========================================================
GET SELLER ORDERS
=========================================================

GET

/api/orders/seller

sellerId comes from Firebase Authentication.
=========================================================
*/

async function getSellerOrdersController(req, res) {

    try {

        const sellerId =
            req.user?.uid;


        if (!sellerId) {

            return res.status(401).json({

                success: false,

                message:
                    "Authenticated user not found."

            });

        }


        const orders =
            await getSellerOrders(
                sellerId
            );


        return res.status(200).json({

            success: true,

            orders,

        });


    } catch (error) {

        console.error(
            "❌ Get seller orders controller error:",
            error
        );


        return res.status(400).json({

            success: false,

            message:
                error.message ||
                "Unable to retrieve seller orders.",

        });

    }

}


/*
=========================================================
CANCEL ORDER
=========================================================

POST

/api/orders/:orderId/cancel
=========================================================
*/

async function cancelOrderController(req, res) {

    try {

        const userId =
            req.user?.uid;


        if (!userId) {

            return res.status(401).json({

                success: false,

                message:
                    "Authenticated user not found."

            });

        }


        const {
            orderId
        } = req.params;


        if (!orderId) {

            return res.status(400).json({

                success: false,

                message:
                    "Order ID is required."

            });

        }


        const {
            reason
        } = req.body;


        const result =
            await cancelOrder({

                orderId,

                userId,

                reason,

            });


        return res.status(200).json({

            success: true,

            ...result,

        });


    } catch (error) {

        console.error(
            "❌ Cancel order controller error:",
            error
        );


        return res.status(400).json({

            success: false,

            message:
                error.message ||
                "Unable to cancel order.",

        });

    }

}


/*
=========================================================
EXPORT
=========================================================
*/

module.exports = {

    createOrderController,

    getOrderController,

    getMyOrdersController,

    getSellerOrdersController,

    cancelOrderController,

};