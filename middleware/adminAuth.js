const { db } = require("../config/firebase");


/*
=========================================================
ADMIN AUTHORIZATION MIDDLEWARE
=========================================================

Purpose:

1. Require Firebase authentication
2. Get authenticated user ID from req.user.uid
3. Verify that the user is an authorized admin
4. Attach admin information to req.admin

IMPORTANT:

Never trust:

req.body.adminId
req.body.role
req.query.adminId

The authenticated Firebase UID is the source of identity.
=========================================================
*/

async function adminAuth(req, res, next) {

    try {

        /*
        =================================================
        VERIFY FIREBASE AUTHENTICATION
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
        FIND ADMIN RECORD
        =================================================

        Recommended collection:

        admins/{userId}

        Example:

        admins/
            USER_FIREBASE_UID

                role: "admin"
                active: true
        =================================================
        */

        const adminRef =
            db
                .collection("admins")
                .doc(userId);


        const adminSnap =
            await adminRef.get();


        if (!adminSnap.exists) {

            return res.status(403).json({

                success: false,

                message:
                    "Administrator access required."

            });

        }


        const admin =
            adminSnap.data();


        /*
        =================================================
        CHECK ADMIN ACTIVE STATUS
        =================================================
        */

        if (
            admin.active === false
        ) {

            return res.status(403).json({

                success: false,

                message:
                    "Administrator account is disabled."

            });

        }


        /*
        =================================================
        OPTIONAL ROLE CHECK
        =================================================

        This allows:

        role: "admin"
        role: "superadmin"

        If no role exists, the existence of the admin
        document is still sufficient.
        =================================================
        */

        if (
            admin.role &&
            ![
                "admin",
                "superadmin"
            ].includes(
                String(admin.role).toLowerCase()
            )
        ) {

            return res.status(403).json({

                success: false,

                message:
                    "Invalid administrator role."

            });

        }


        /*
        =================================================
        ATTACH ADMIN
        =================================================
        */

        req.admin = {

            id:
                userId,

            ...admin

        };


        /*
        =================================================
        CONTINUE
        =================================================
        */

        next();


    } catch (error) {

        console.error(
            "❌ Admin authorization error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to verify administrator permissions."

        });

    }

}


module.exports = {

    adminAuth

};