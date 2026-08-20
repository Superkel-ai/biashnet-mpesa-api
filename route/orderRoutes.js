const express = require("express");

const router =
    express.Router();


const {
    requireAuth
} = require("../middleware/auth");


const {
    createOrderController,
    getOrderController,
    getMyOrdersController,
    getSellerOrdersController,
    cancelOrderController,
} = require("../controller/orderController");


/*
=========================================================
ORDER ROUTES
=========================================================

All order routes require Firebase authentication.

Flow:

Android
   ↓
Firebase ID Token
   ↓
requireAuth
   ↓
orderController
   ↓
orderService
   ↓
Firestore
=========================================================
*/


/*
=========================================================
CREATE ORDER
=========================================================

POST

/api/orders

Body:

{
    "listingId": "LISTING_ID",
    "quantity": 1,
    "buyerPhone": "0712345678",
    "deliveryAddress": "Juja",
    "deliveryMethod": "PICKUP"
}

IMPORTANT:

buyerId is NOT accepted from Android.

It comes from:

req.user.uid
=========================================================
*/

router.post(
    "/",
    requireAuth,
    createOrderController
);


/*
=========================================================
GET MY ORDERS
=========================================================

GET

/api/orders/my
=========================================================
*/

router.get(
    "/my",
    requireAuth,
    getMyOrdersController
);


/*
=========================================================
GET SELLER ORDERS
=========================================================

GET

/api/orders/seller

The seller ID comes from:

req.user.uid
=========================================================
*/

router.get(
    "/seller",
    requireAuth,
    getSellerOrdersController
);


/*
=========================================================
GET SINGLE ORDER
=========================================================

GET

/api/orders/:orderId
=========================================================
*/

router.get(
    "/:orderId",
    requireAuth,
    getOrderController
);


/*
=========================================================
CANCEL ORDER
=========================================================

POST

/api/orders/:orderId/cancel
=========================================================
*/

router.post(
    "/:orderId/cancel",
    requireAuth,
    cancelOrderController
);


module.exports = router;