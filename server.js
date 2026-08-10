const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { db } = require("./config/firebase");

const stkRoutes = require("./routes/stk");
const withdrawRoutes = require("./routes/withdraw");
const callbackRoutes = require("./routes/callback");
const adminInvestorRoutes = require("./routes/adminInvestors");
const adminActualRoutes = require("./routes/adminActual");
const marketplaceOrderRoutes = require("./routes/marketplaceOrders");
const marketplacePaymentRoutes = require("./routes/marketplacePayments");
const marketplaceWalletRoutes = require("./routes/marketplaceWallet");
const marketplaceWithdrawalRoutes = require("./routes/marketplaceWithdrawals");
const app = express();


/* =========================
   MIDDLEWARE
========================= */

app.use(cors());

app.use(express.json());

app.use(
  express.urlencoded({
    extended: true
  })
);


/* =========================
   HEALTH CHECK
========================= */

app.get("/", (req, res) => {

  res.json({

    success: true,

    app: "Biashnet Payment API",

    status: "LIVE",

  });

});


/* =========================
   PAYMENT ROUTES
========================= */

app.use(
  "/api",
  stkRoutes
);


app.use(
  "/api",
  withdrawRoutes
);


app.use(
  "/api",
  callbackRoutes
);

app.use(
    "/api/marketplace/orders",
    marketplaceOrderRoutes
);


app.use(
    "/api/marketplace/payments",
    marketplacePaymentRoutes
);

app.use(
    "/api/marketplace/wallet",
    marketplaceWalletRoutes
);

app.use(
    "/api/marketplace/withdrawals",
    marketplaceWithdrawalRoutes
);
/* =========================
   ADMIN INVESTOR ROUTES
========================= */

app.use(
  "/api/admin/investors",
  adminInvestorRoutes
);

/* =========================
   ADMIN ACTUAL / EXPENSE ROUTES
========================= */

app.use(
  "/api/admin/actual",
  adminActualRoutes
);

/* =========================
   B2C CALLBACK
   WITHDRAWALS
========================= */

app.post(
  "/b2c/result",
  async (req, res) => {

    try {

      const result =
        req.body?.Result;


      if (!result) {

        return res.send("OK");

      }


      const transactionId =
        result.TransactionID;


      const resultCode =
        result.ResultCode;


      const snap =
        await db
          .collection("withdrawalRequests")
          .where(
            "transactionId",
            "==",
            transactionId
          )
          .limit(1)
          .get();


      if (snap.empty) {

        return res.send("OK");

      }


      const withdrawalDoc =
        snap.docs[0];


      const data =
        withdrawalDoc.data();


      /* =========================
         SUCCESSFUL WITHDRAWAL
      ========================= */

      if (resultCode === 0) {

        await withdrawalDoc.ref.update({

          status: "PAID",

          updatedAt: new Date(),

        });

      }


      /* =========================
         FAILED WITHDRAWAL
      ========================= */

      else {

        const walletRef =
          db
            .collection("wallets")
            .doc(data.userId);


        const walletSnap =
          await walletRef.get();


        if (walletSnap.exists) {

          const wallet =
            walletSnap.data();


          const currentLocked =
            Number(
              wallet.lockedBalance || 0
            );


          const withdrawalAmount =
            Number(
              data.amount || 0
            );


          await walletRef.update({

            lockedBalance:
              Math.max(
                0,
                currentLocked -
                withdrawalAmount
              ),

            updatedAt:
              new Date(),

          });

        }


        await withdrawalDoc.ref.update({

          status: "FAILED",

          updatedAt: new Date(),

        });

      }


      return res.send("OK");


    } catch (err) {

      console.error(
        "B2C callback error:",
        err
      );


      return res.send("OK");

    }

  }
);


/* =========================
   START SERVER
========================= */

const PORT =
  process.env.PORT || 3000;


app.listen(
  PORT,
  () => {

    console.log(
      `🚀 Server running on ${PORT}`
    );

  }
);