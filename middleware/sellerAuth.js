const { db } = require("../config/firebase");


/*
=========================================================
SELLER AUTHORIZATION MIDDLEWARE
=========================================================

Purpose:

1. Require Firebase authentication
2. Get seller from authenticated Firebase UID
3. Verify seller profile exists
4. Verify seller is active
5. Attach seller information to req.seller

IMPORTANT:

Never accept sellerId from the frontend as proof of ownership.

The seller is determined from:

req.user.uid

=========================================================
*/

async function sellerAuth(req, res, next) {

    try {

        /*
        =================================================
        GET AUTHENTICATED USER
        =================================================
        */

        const userId =
            req.user?.uid;


        if (!userId) {

            return res.status(401).json({

                success: false,

                message:
                    "Authentication is required."

            });

        }


        /*
        =================================================
        GET SELLER PROFILE
        =================================================
        */

        const sellerRef =
            db
                .collection("sellers")
                .doc(userId);


        const sellerSnap =
            await sellerRef.get();


        /*
        =================================================
        SELLER NOT FOUND
        =================================================
        */

        if (!sellerSnap.exists) {

            return res.status(403).json({

                success: false,

                message:
                    "Seller account required."

            });

        }


        const seller =
            sellerSnap.data();


        /*
        =================================================
        CHECK SELLER STATUS
        =================================================
        */

        if (
            seller.status &&
            ![
                "ACTIVE",
                "VERIFIED",
                "APPROVED"
            ].includes(
                String(
                    seller.status
                ).toUpperCase()
            )
        ) {

            return res.status(403).json({

                success: false,

                message:
                    "Seller account is not active."

            });

        }


        /*
        =================================================
        CHECK EXPLICIT ACTIVE FLAG
        =================================================
        */

        if (
            seller.active === false
        ) {

            return res.status(403).json({

                success: false,

                message:
                    "Seller account is disabled."

            });

        }


        /*
        =================================================
        ATTACH SELLER
        =================================================
        */

        req.seller = {

            id:
                userId,

            ...seller

        };


        /*
        =================================================
        CONTINUE
        =================================================
        */

        next();


    } catch (error) {

        console.error(
            "❌ Seller authorization error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to verify seller permissions."

        });

    }

}


module.exports = {

    sellerAuth

};