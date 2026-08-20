const {
    createCheckout,
    getCheckout
} = require("../service/checkoutService");


/*
=========================================================
CHECKOUT CONTROLLER
=========================================================

Responsibilities:

- Receive HTTP request
- Get authenticated buyer
- Validate request
- Call checkoutService
- Return response

The controller DOES NOT:

- Read products directly
- Calculate prices
- Calculate commission
- Create orders directly
- Trust buyerId from frontend
=========================================================
*/


/*
=========================================================
CREATE CHECKOUT
=========================================================
*/

async function createCheckoutController(
    req,
    res
) {

    try {

        /*
        =================================================
        AUTHENTICATED BUYER
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
        REQUEST BODY
        =================================================
        */

        const {

            items,

            buyerPhone,

            deliveryAddress

        } = req.body;


        /*
        =================================================
        BASIC VALIDATION
        =================================================
        */

        if (
            !Array.isArray(items) ||
            items.length === 0
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Checkout items are required."

            });

        }


        /*
        =================================================
        CREATE CHECKOUT
        =================================================
        */

        const result =
            await createCheckout({

                buyerId,

                items,

                buyerPhone,

                deliveryAddress

            });


        /*
        =================================================
        RESPONSE
        =================================================
        */

        return res.status(201).json({

            success: true,

            ...result

        });


    } catch (error) {

        console.error(
            "❌ Checkout controller error:",
            error
        );


        return res.status(400).json({

            success: false,

            message:
                error.message ||
                "Unable to create checkout."

        });

    }

}


/*
=========================================================
GET CHECKOUT
=========================================================
*/

async function getCheckoutController(
    req,
    res
) {

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


        /*
        =================================================
        ORDER ID
        =================================================
        */

        const orderId =
            req.params.orderId;


        if (!orderId) {

            return res.status(400).json({

                success: false,

                message:
                    "Order ID is required."

            });

        }


        /*
        =================================================
        GET CHECKOUT
        =================================================
        */

        const result =
            await getCheckout({

                orderId,

                buyerId

            });


        if (!result) {

            return res.status(404).json({

                success: false,

                message:
                    "Checkout/order not found."

            });

        }


        /*
        =================================================
        RESPONSE
        =================================================
        */

        return res.status(200).json({

            success: true,

            order:
                result

        });


    } catch (error) {

        console.error(
            "❌ Get checkout controller error:",
            error
        );


        /*
        Unauthorized access should not expose
        unnecessary information.
        */

        if (
            error.message ===
            "You are not authorized to access this order."
        ) {

            return res.status(403).json({

                success: false,

                message:
                    "You are not authorized to access this order."

            });

        }


        return res.status(400).json({

            success: false,

            message:
                error.message ||
                "Unable to retrieve checkout."

        });

    }

}


module.exports = {

    createCheckoutController,

    getCheckoutController

};