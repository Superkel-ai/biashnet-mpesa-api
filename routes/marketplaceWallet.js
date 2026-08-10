const express = require("express");

const router = express.Router();

const {
    getOrCreateSellerWallet,
} = require("../services/marketplaceSellerWallet");

const { db } = require("../config/firebase");


/*
=========================================================
GET SELLER MARKETPLACE WALLET
=========================================================

GET /api/marketplace/wallet

Returns:

availableBalance
pendingBalance
lockedBalance
totalSales
totalEarnings
totalCommission
totalWithdrawn
=========================================================
*/

router.get(
    "/wallet",
    async (req, res) => {

        try {

            const userId =
                req.query.userId;


            if (!userId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Seller userId is required.",

                });

            }


            const wallet =
                await getOrCreateSellerWallet(
                    userId
                );


            return res.status(200).json({

                success: true,

                wallet,

            });

        } catch (error) {

            console.error(
                "Marketplace wallet error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    error.message ||
                    "Failed to load marketplace wallet.",

            });

        }

    }
);


/*
=========================================================
GET SELLER MARKETPLACE LEDGER
=========================================================

GET /api/marketplace/wallet/ledger?userId=...
=========================================================
*/

router.get(
    "/wallet/ledger",
    async (req, res) => {

        try {

            const userId =
                req.query.userId;


            if (!userId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Seller userId is required.",

                });

            }


            const snapshot =
                await db
                    .collection(
                        "marketplaceLedger"
                    )
                    .where(
                        "userId",
                        "==",
                        userId
                    )
                    .orderBy(
                        "createdAt",
                        "desc"
                    )
                    .limit(100)
                    .get();


            const ledger =
                snapshot.docs.map(
                    (doc) => ({

                        id:
                            doc.id,

                        ...doc.data(),

                    })
                );


            return res.status(200).json({

                success: true,

                ledger,

            });

        } catch (error) {

            console.error(
                "Marketplace ledger error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    error.message ||
                    "Failed to load marketplace ledger.",

            });

        }

    }
);


module.exports = router;