const express = require("express");

const router = express.Router();


const {
    initiateMarketplacePayment,
} = require(
    "../services/marketplacePayment"
);


/*
=========================================================
INITIATE MARKETPLACE PAYMENT
=========================================================

POST

/api/marketplace/payments

Body:

{
    orderId,
    buyerId,
    phoneNumber
}

The payment service should:

1. Verify order exists
2. Verify order belongs to buyer
3. Verify order is payable
4. Get order total
5. Initiate M-PESA STK
6. Save payment information
7. Return checkout information

=========================================================
*/

router.post(
    "/initiate",
    async (req, res) => {

        try {

            const {

                orderId,

                buyerId,

                phoneNumber,

            } = req.body;


            /*
            =========================================
            VALIDATION
            =========================================
            */

            if (!orderId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Order ID is required.",

                });

            }


            if (!buyerId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Buyer ID is required.",

                });

            }


            if (!phoneNumber) {

                return res.status(400).json({

                    success: false,

                    message:
                        "M-PESA phone number is required.",

                });

            }


            /*
            =========================================
            INITIATE PAYMENT
            =========================================
            */

            const result =
                await initiateMarketplacePayment({

                    orderId,

                    buyerId,

                    phoneNumber,

                });


            /*
            =========================================
            RESPONSE
            =========================================
            */

            return res.status(200).json({

                success: true,

                message:
                    "Marketplace payment initiated successfully.",

                payment:
                    result,

            });

        } catch (error) {

            console.error(
                "Marketplace payment error:",
                error
            );


            return res.status(400).json({

                success: false,

                message:
                    error.message ||
                    "Failed to initiate marketplace payment.",

            });

        }

    }
);


module.exports = router;