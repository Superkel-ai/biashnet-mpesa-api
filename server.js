const { creditWallet } = require("./services/wallet");
const { saveTransaction } = require("./services/transactions");
const { db } = require("./config/firebase");
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const stkRoutes = require("./routes/stk");

const app = express();

/* =========================================
   MIDDLEWARE
========================================= */

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================================
   HEALTH CHECK
========================================= */

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    app: "Biashnet M-Pesa API",
    status: "LIVE",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
  });
});

/* =========================================
   API ROUTES
========================================= */

app.use("/api", stkRoutes);

/* =========================================
   MPESA CALLBACK (PRODUCTION)
========================================= */
app.post("/callback", async (req, res) => {
  try {
    console.log("📩 MPESA CALLBACK RECEIVED");

    const callback = req.body?.Body?.stkCallback;

    if (!callback) {
      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: "No callback body",
      });
    }

    const checkoutRequestID = callback.CheckoutRequestID;
    const resultCode = callback.ResultCode;

    // Find original deposit request
    const pendingRef = db
      .collection("pendingTransactions")
      .doc(checkoutRequestID);

    const pendingDoc = await pendingRef.get();

    if (!pendingDoc.exists) {
      throw new Error(
        `Pending transaction not found: ${checkoutRequestID}`
      );
    }

    const pending = pendingDoc.data();

    const userId = pending.userId;
    const phone = pending.phone;
    const requestedAmount = pending.amount;

    // Payment failed
    if (resultCode !== 0) {
      await pendingRef.update({
        status: "FAILED",
        resultCode,
        updatedAt: new Date(),
      });

      console.log(
        `❌ Payment failed. ResultCode: ${resultCode}`
      );

      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: "Callback processed",
      });
    }

    let amount = requestedAmount;
    let receiptNumber = "";

    const items =
      callback.CallbackMetadata?.Item || [];

    items.forEach((item) => {
      if (item.Name === "Amount") {
        amount = Number(item.Value);
      }

      if (item.Name === "MpesaReceiptNumber") {
        receiptNumber = String(item.Value);
      }
    });

    if (!receiptNumber) {
      throw new Error("Receipt number missing");
    }

    // Save permanent transaction
    await saveTransaction({
      transactionId: receiptNumber,
      checkoutRequestID,
      userId,
      phone,
      amount,
      receiptNumber,
      type: "DEPOSIT",
      status: "SUCCESS",
    });

    // Credit wallet
    await creditWallet({
      userId,
      phone,
      amount,
      receiptNumber,
    });

    // Mark pending transaction complete
    await pendingRef.update({
      status: "SUCCESS",
      receiptNumber,
      completedAt: new Date(),
    });

    console.log(
      `✅ Deposit completed | User: ${userId} | Amount: ${amount}`
    );

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Accepted",
    });
  } catch (error) {
    console.error(
      "❌ Callback Error:",
      error.message
    );

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Error acknowledged",
    });
  }
});

/* =========================================
   ERROR HANDLER
========================================= */

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

/* =========================================
   START SERVER
========================================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Biashnet API running on port ${PORT}`);
});