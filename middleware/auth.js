const { admin } = require("../config/firebase");


/*
=========================================================
FIREBASE AUTHENTICATION MIDDLEWARE
=========================================================
*/

async function requireAuth(req, res, next) {

    try {

        const authHeader =
            req.headers.authorization;


        console.log(
            "🔐 Authorization header received:",
            authHeader
                ? "YES"
                : "NO"
        );


        if (!authHeader) {

            return res.status(401).json({

                success: false,

                message:
                    "Authentication token is required."

            });

        }


        if (
            !authHeader.startsWith("Bearer ")
        ) {

            console.error(
                "❌ Invalid Authorization format:",
                authHeader.substring(
                    0,
                    20
                )
            );

            return res.status(401).json({

                success: false,

                message:
                    "Invalid authentication format."

            });

        }


        const token =
            authHeader.substring(
                7
            ).trim();


        if (!token) {

            return res.status(401).json({

                success: false,

                message:
                    "Authentication token is missing."

            });

        }


        console.log(
            "🔐 Firebase token received. Length:",
            token.length
        );


        /*
        =====================================================
        VERIFY FIREBASE TOKEN
        =====================================================
        */

        const decodedToken =
            await admin
                .auth()
                .verifyIdToken(token);


        /*
        =====================================================
        SUCCESS
        =====================================================
        */

        console.log(
            "✅ Firebase authentication successful:",
            decodedToken.uid
        );


        req.user =
            decodedToken;


        next();


    } catch (error) {

        console.error(
            "❌ Firebase authentication error"
        );

        console.error(
            "Code:",
            error.code
        );

        console.error(
            "Message:",
            error.message
        );

        return res.status(401).json({

            success: false,

            message:
                "Invalid or expired authentication token.",

            /*
             * TEMPORARY DEBUG INFORMATION
             *
             * Remove this after debugging.
             */

            debug:
                process.env.NODE_ENV !==
                "production"
                    ? error.message
                    : undefined,

        });

    }

}


module.exports = {
    requireAuth
};