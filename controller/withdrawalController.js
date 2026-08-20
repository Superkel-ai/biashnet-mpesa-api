const {
    createWithdrawal,
    getWithdrawal,
    getUserWithdrawals,
    cancelWithdrawal
} = require("../service/withdrawalService");


/*
=========================================================
WITHDRAWAL CONTROLLER
=========================================================

Responsibilities:

- Receive HTTP request
- Get authenticated user from req.user
- Validate request-level input
- Pass trusted userId to withdrawalService
- Return HTTP response

The controller does NOT:

- directly access Firestore
- calculate wallet balances
- transfer M-Pesa
- release/lock wallet funds
- decide another user's withdrawal
=========================================================
*/


/*
=========================================================
CREATE WITHDRAWAL
=========================================================

POST

/api/withdrawals

Body:

{
    "amount": 500,
    "phoneNumber": "0712345678"
}

userId comes from Firebase Authentication.
=========================================================
*/

async function create(req, res) {

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
            amount,
            phoneNumber
        } = req.body;


        if (
            amount === undefined ||
            amount === null
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Withdrawal amount is required."

            });

        }


        if (
            !phoneNumber
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Phone number is required."

            });

        }


        const result =
            await createWithdrawal({

                userId,

                amount,

                phoneNumber

            });


        return res.status(201).json({

            success: true,

            ...result

        });


    } catch (error) {

        console.error(
            "❌ Create withdrawal controller error:",
            error
        );


        return res.status(400).json({

            success: false,

            message:
                error.message ||
                "Unable to create withdrawal."

        });

    }

}


/*
=========================================================
GET MY WITHDRAWAL
=========================================================

GET

/api/withdrawals/:withdrawalId

A seller/user can only retrieve their own withdrawal.
=========================================================
*/

async function getMyWithdrawal(req, res) {

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
            withdrawalId
        } = req.params;


        if (!withdrawalId) {

            return res.status(400).json({

                success: false,

                message:
                    "Withdrawal ID is required."

            });

        }


        const withdrawal =
            await getWithdrawal({

                withdrawalId,

                userId

            });


        if (!withdrawal) {

            return res.status(404).json({

                success: false,

                message:
                    "Withdrawal not found."

            });

        }


        return res.status(200).json({

            success: true,

            withdrawal

        });


    } catch (error) {

        console.error(
            "❌ Get withdrawal controller error:",
            error
        );


        return res.status(400).json({

            success: false,

            message:
                error.message ||
                "Unable to retrieve withdrawal."

        });

    }

}


/*
=========================================================
GET MY WITHDRAWALS
=========================================================

GET

/api/withdrawals

Returns withdrawals belonging to authenticated user.
=========================================================
*/

async function getMyWithdrawals(req, res) {

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


        const withdrawals =
            await getUserWithdrawals({

                userId

            });


        return res.status(200).json({

            success: true,

            withdrawals

        });


    } catch (error) {

        console.error(
            "❌ Get withdrawals controller error:",
            error
        );


        return res.status(400).json({

            success: false,

            message:
                error.message ||
                "Unable to retrieve withdrawals."

        });

    }

}


/*
=========================================================
CANCEL WITHDRAWAL
=========================================================

POST

/api/withdrawals/:withdrawalId/cancel

Only the authenticated owner can cancel it.

The service decides whether the withdrawal is actually
cancellable and whether locked funds can be released.
=========================================================
*/

async function cancel(req, res) {

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
            withdrawalId
        } = req.params;


        if (!withdrawalId) {

            return res.status(400).json({

                success: false,

                message:
                    "Withdrawal ID is required."

            });

        }


        const result =
            await cancelWithdrawal({

                withdrawalId,

                userId

            });


        return res.status(200).json({

            success: true,

            ...result

        });


    } catch (error) {

        console.error(
            "❌ Cancel withdrawal controller error:",
            error
        );


        return res.status(400).json({

            success: false,

            message:
                error.message ||
                "Unable to cancel withdrawal."

        });

    }

}


module.exports = {

    create,

    getMyWithdrawal,

    getMyWithdrawals,

    cancel

};