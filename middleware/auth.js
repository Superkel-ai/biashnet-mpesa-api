const { admin } = require("../config/firebase");


/*
=========================================
FIREBASE AUTHENTICATION MIDDLEWARE
=========================================
*/

async function requireAuth(req, res, next) {

    try {

        /*
        -----------------------------------------
        GET AUTHORIZATION HEADER
        -----------------------------------------
        */

        const authHeader =
            req.headers.authorization;


        if (!authHeader) {

            return res.status(401).json({

                success: false,

                message:
                    "Authentication token is required."

            });

        }


        /*
        -----------------------------------------
        CHECK BEARER FORMAT
        -----------------------------------------
        */

        if (
            !authHeader.startsWith("Bearer ")
        ) {

            return res.status(401).json({

                success: false,

                message:
                    "Invalid authentication format."

            });

        }


        /*
        -----------------------------------------
        EXTRACT TOKEN
        -----------------------------------------
        */

        const token =
            authHeader.split("Bearer ")[1];


        if (!token) {

            return res.status(401).json({

                success: false,

                message:
                    "Authentication token is missing."

            });

        }


        /*
        -----------------------------------------
        VERIFY FIREBASE TOKEN
        -----------------------------------------
        */

        const decodedToken =
            await admin
                .auth()
                .verifyIdToken(token);


        /*
        -----------------------------------------
        ATTACH USER TO REQUEST
        -----------------------------------------
        */

        req.user = decodedToken;


        /*
        req.user now contains things such as:

        req.user.uid
        req.user.email
        req.user.email_verified
        req.user.name
        etc.

        -----------------------------------------
        */

        next();


    } catch (error) {

        console.error(
            "Firebase authentication error:",
            error
        );


        return res.status(401).json({

            success: false,

            message:
                "Invalid or expired authentication token."

        });

    }

}


module.exports = {
    requireAuth
};