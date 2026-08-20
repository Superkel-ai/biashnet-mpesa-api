const express = require("express");
const cors = require("cors");
require("dotenv").config();

const checkoutRoutes = require("./route/checkoutRoutes");
const paymentRoutes = require("./route/paymentRoutes");
const orderRoutes = require("./route/orderRoutes");
const withdrawalRoutes = require("./route/withdrawalRoutes");
const webhookRoutes = require("./route/webhookRoutes");

const app = express();

app.use(cors());

app.use(express.json());

app.use(
    express.urlencoded({
        extended: true
    })
);


/*
=========================================================
HEALTH CHECK
=========================================================
*/

app.get("/", (req, res) => {

    res.json({
        success: true,
        app: "Biashnet Payment API",
        status: "LIVE"
    });

});


/*
=========================================================
MARKETPLACE CHECKOUT
=========================================================
*/

app.use(
    "/api/payments",
    checkoutRoutes
);


/*
=========================================================
MARKETPLACE PAYMENT
=========================================================
*/

app.use(
    "/api/payments",
    paymentRoutes
);


/*
=========================================================
ORDERS
=========================================================
*/

app.use(
    "/api/orders",
    orderRoutes
);


/*
=========================================================
WITHDRAWALS
=========================================================
*/

app.use(
    "/api/withdrawals",
    withdrawalRoutes
);


/*
=========================================================
M-PESA WEBHOOKS
=========================================================
*/

app.use(
    "/api/webhooks",
    webhookRoutes
);


/*
=========================================================
ERROR HANDLER
=========================================================
*/

app.use((err, req, res, next) => {

    console.error(err);

    res.status(500).json({
        success: false,
        message:
            err.message ||
            "Internal server error."
    });

});


/*
=========================================================
START
=========================================================
*/

const PORT =
    process.env.PORT || 3000;

app.listen(
    PORT,
    () => {

        console.log(
            `🚀 Biashnet backend running on port ${PORT}`
        );

    }
);