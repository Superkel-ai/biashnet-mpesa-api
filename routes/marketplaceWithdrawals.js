const express = require("express");

const router = express.Router();

const {
    createMarketplaceWithdrawal,
    markWithdrawalProcessing,
    getMarketplaceWithdrawal,
    getSellerWithdrawals,
} = require(
    "../services/marketplaceWithdrawal"
);


/*
=========================================================
CREATE MARKETPLACE WITHDRAWAL
=========================================================

POST

/api/marketplace/withdrawals

Body:

{
    sellerId,
    amount,
    phoneNumber
}

The service automatically:

availableBalance
        ↓
lockedBalance

and creates:

marketplaceWithdrawals
marketplaceLedger
=========================================================
*/

router.post(
    "/withdrawals",
    async (req, res) => {

        try {

            const {

                sellerId,

                amount,

                phoneNumber,

            } = req.body;


            if (!sellerId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Seller ID is required.",

                });

            }


            if (
                amount === undefined ||
                amount === null
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Withdrawal amount is required.",

                });

            }


            if (!phoneNumber) {

                return res.status(400).json({

                    success: false,

                    message:
                        "M-PESA phone number is required.",

                });

            }


            const result =
                await createMarketplaceWithdrawal({

                    sellerId,

                    amount,

                    phoneNumber,

                });


            return res.status(201).json({

                success: true,

                message:
                    "Marketplace withdrawal request created successfully.",

                withdrawal:
                    result,

            });

        } catch (error) {

            console.error(
                "Marketplace withdrawal error:",
                error
            );


            return res.status(400).json({

                success: false,

                message:
                    error.message ||
                    "Failed to create withdrawal.",

            });

        }

    }
);


/*
=========================================================
GET SELLER WITHDRAWALS
=========================================================

GET

/api/marketplace/withdrawals/seller/:sellerId
=========================================================
*/

router.get(
    "/withdrawals/seller/:sellerId",
    async (req, res) => {

        try {

            const {
                sellerId
            } = req.params;


            if (!sellerId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Seller ID is required.",

                });

            }


            const withdrawals =
                await getSellerWithdrawals(
                    sellerId
                );


            return res.status(200).json({

                success: true,

                withdrawals,

            });

        } catch (error) {

            console.error(
                "Seller withdrawals error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    error.message ||
                    "Failed to load withdrawals.",

            });

        }

    }
);


/*
=========================================================
GET SINGLE WITHDRAWAL
=========================================================

GET

/api/marketplace/withdrawals/:withdrawalId
=========================================================
*/

router.get(
    "/withdrawals/:withdrawalId",
    async (req, res) => {

        try {

            const {
                withdrawalId
            } = req.params;


            const withdrawal =
                await getMarketplaceWithdrawal(
                    withdrawalId
                );


            return res.status(200).json({

                success: true,

                withdrawal,

            });

        } catch (error) {

            console.error(
                "Get marketplace withdrawal error:",
                error
            );


            return res.status(404).json({

                success: false,

                message:
                    error.message ||
                    "Withdrawal not found.",

            });

        }

    }
);


/*
=========================================================
MARK WITHDRAWAL PROCESSING
=========================================================

This should be called by the backend after
successfully initiating the M-PESA B2C request.

POST

/api/marketplace/withdrawals/:withdrawalId/processing

Body:

{
    conversationId,
    originatorConversationId
}

=========================================================
*/

router.post(
    "/withdrawals/:withdrawalId/processing",
    async (req, res) => {

        try {

            const {
                withdrawalId
            } = req.params;


            const {

                conversationId,

                originatorConversationId,

            } = req.body;


            const result =
                await markWithdrawalProcessing({

                    withdrawalId,

                    conversationId,

                    originatorConversationId,

                });


            return res.status(200).json({

                success: true,

                withdrawal:
                    result,

            });

        } catch (error) {

            console.error(
                "Mark withdrawal processing error:",
                error
            );


            return res.status(400).json({

                success: false,

                message:
                    error.message ||
                    "Failed to update withdrawal.",

            });

        }

    }
);


module.exports = router;