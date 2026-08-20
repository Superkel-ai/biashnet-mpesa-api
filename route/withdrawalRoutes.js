const express = require("express");

const router =
    express.Router();


const {
    create,
    getMyWithdrawal,
    getMyWithdrawals,
    cancel
} = require("../controller/withdrawalController");


const {
    requireAuth
} = require("../middleware/auth");


/*
=========================================================
WITHDRAWAL ROUTES
=========================================================

Base path:

/api/withdrawals

All routes require Firebase authentication.

Flow:

Android
   ↓
Firebase ID Token
   ↓
requireAuth
   ↓
withdrawalController
   ↓
withdrawalService
   ↓
Wallet / M-Pesa / Firestore
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

The user ID is NEVER accepted from the frontend.

It comes from:

req.user.uid
=========================================================
*/

router.post(
    "/",
    requireAuth,
    create
);


/*
=========================================================
GET MY WITHDRAWALS
=========================================================

GET

/api/withdrawals

Returns only withdrawals belonging to the authenticated
user.
=========================================================
*/

router.get(
    "/",
    requireAuth,
    getMyWithdrawals
);


/*
=========================================================
GET ONE WITHDRAWAL
=========================================================

GET

/api/withdrawals/:withdrawalId
=========================================================
*/

router.get(
    "/:withdrawalId",
    requireAuth,
    getMyWithdrawal
);


/*
=========================================================
CANCEL WITHDRAWAL
=========================================================

POST

/api/withdrawals/:withdrawalId/cancel
=========================================================
*/

router.post(
    "/:withdrawalId/cancel",
    requireAuth,
    cancel
);


module.exports = router;