const express = require("express");

const router =
    express.Router();


const {
    initiatePayment
} = require("../controller/paymentController");


const {
    requireAuth
} = require("../middleware/auth");


/*
=========================================================
MARKETPLACE PAYMENT ROUTES
=========================================================

All routes in this file are protected.

Flow:

Android
   ↓
Firebase ID Token
   ↓
requireAuth
   ↓
paymentController
   ↓
paymentInitiationService
=========================================================
*/


/*
=========================================================
INITIATE PAYMENT
=========================================================

POST

/api/payments/initiate

Body:

{
    "orderId": "ORD-...",
    "phoneNumber": "0712345678",
    "paymentMethod": "MPESA"
}

IMPORTANT:

buyerId is NOT accepted from the frontend.

It comes from:

req.user.uid
=========================================================
*/

router.post(
    "/initiate",
    requireAuth,
    initiatePayment
);


module.exports = router;