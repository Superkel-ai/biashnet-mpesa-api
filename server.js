const { creditWallet } = require("./services/wallet");
const { saveTransaction } = require("./services/transactions");

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
   MPESA CALLBACK
========================================= */
app.post("/callback", async (req, res) => {
  try {
    console.log("📩 MPESA CALLBACK RECEIVED");

    const callback = req.body.Body?.stkCallback;

    if (!callback) {
      return res.status(200).json({ ResultCode: 0, ResultDesc: "No callback body" });
    }

    // If payment failed
    if (callback.ResultCode !== 0) {
      console.log(`❌ Payment failed or cancelled. ResultCode: ${callback.ResultCode}`);
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Callback processed" });
    }

    let amount = 0;
    let phone = "";
    let receiptNumber = ""; // Changed variable name to align with services

    const items = callback.CallbackMetadata?.Item || [];

    items.forEach((item) => {
      if (item.Name === "Amount") amount = item.Value;
      if (item.Name === "PhoneNumber") phone = item.Value;
      if (item.Name === "MpesaReceiptNumber") receiptNumber = item.Value;
    });

    const checkoutRequestID = callback.CheckoutRequestID;

    // 1. Save transaction (using transaction runner)
    await saveTransaction({
      checkoutRequestID,
      phone,
      amount,
      receiptNumber, // Matched parameter name
      status: "SUCCESS",
    });

    // 2. Credit wallet (Fixed: Passing as an object matching your service schema)
    await creditWallet({ 
      phone, 
      amount, 
      receiptNumber 
    });

    console.log(`💰 Wallet credited successfully for ${phone}`);

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Accepted",
    });

  } catch (error) {
    console.error("Callback Error:", error.message);

    // M-Pesa expects a 200 OK even on error to stop repeating callbacks
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