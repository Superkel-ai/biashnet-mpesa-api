const express = require("express");

const router =
    express.Router();

const {
    requireAuth
} = require("../middleware/auth");

const {
    createCheckoutController,
    getCheckoutController
} = require("../controller/checkoutController");


/*
=========================================================
CREATE CHECKOUT
=========================================================

POST

/api/payments/checkout
=========================================================
*/

router.post(
    "/checkout",
    requireAuth,
    createCheckoutController
);


/*
=========================================================
GET CHECKOUT
=========================================================

GET

/api/payments/checkout/:orderId
=========================================================
*/

router.get(
    "/checkout/:orderId",
    requireAuth,
    getCheckoutController
);


module.exports = router;