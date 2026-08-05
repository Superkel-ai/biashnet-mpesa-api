const express = require("express");
const router = express.Router();

const { db } = require("../config/firebase");
const { stkPush } = require("../services/mpesa");
const { createWalletIfNotExists } = require("../services/walletInit");

const { v4: uuidv4 } = require("uuid");

/* =========================================
   STK PUSH (PRODUCTION SAFE)
========================================= */
router.post("/stkpush", async (req, res) => {
  try {
    let {
  userId,
  phone,
  amount,
  paymentType,
  referenceId
} = req.body;
    // =========================
    // VALIDATION
    // =========================
    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    if (!phone) {
      return res.status(400).json({ success: false, message: "phone is required" });
    }

    amount = Number(amount);

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "valid amount is required" });
    }

    // =========================
    // NORMALIZE PHONE (IMPORTANT)
    // =========================
    if (phone.startsWith("0")) {
      phone = "254" + phone.slice(1);
    }

    if (!phone.startsWith("254")) {
      return res.status(400).json({
        success: false,
        message: "phone must be in 2547XXXXXXXX format",
      });
    }

    // =========================
// CREATE MPESA ACCOUNT REFERENCE
// =========================

let accountReference = "BIASHNET";

if (paymentType === "INVESTMENT") {

  accountReference =
    `INVEST-${referenceId?.slice(0,8)}`;

}

if (paymentType === "ORDER") {

  accountReference =
    `ORDER-${referenceId?.slice(0,8)}`;

}

if (paymentType === "WALLET") {

  accountReference =
    `WALLET-${referenceId?.slice(0,8)}`;

}

    // =========================
    // ENSURE WALLET EXISTS
    // =========================
    await createWalletIfNotExists(userId, phone);

    // =========================
    // PREVENT DOUBLE SUBMIT (VERY IMPORTANT)
    // =========================
    const requestId = uuidv4();

    await db.collection("stkRequests").doc(requestId).set({
      requestId,
      userId,
      phone,
      amount,
      status: "INITIATED",
      createdAt: new Date(),
    });

    // =========================
// INITIATE M-PESA STK PUSH
// =========================
const response = await stkPush(
  phone,
  amount,
  accountReference
);

// Log the full response so we know the exact fields
console.log("✅ M-PESA RESPONSE:", JSON.stringify(response, null, 2));

// =========================
// SAVE PENDING TRANSACTION
// =========================
await db
  .collection("pendingTransactions")
  .doc(response.CheckoutRequestID)
  .set({
    checkoutRequestID: response.CheckoutRequestID,
    merchantRequestID: response.MerchantRequestID,
    apiRef: requestId,
    userId,
    phone,
    amount,
    status: "PENDING",
    provider: "MPESA",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

console.log("🟡 Pending transaction created:", requestId);

// =========================
// RETURN RESPONSE
// =========================
return res.status(200).json({
  success: true,
  message: response.CustomerMessage,
  checkoutRequestID: response.CheckoutRequestID,
  merchantRequestID: response.MerchantRequestID,
});
  } catch (error) {
    console.error("❌ STK Error:", error.response?.data || error.message);

    return res.status(500).json({
      success: false,
      message: "STK Push failed",
      error: error.response?.data || error.message,
    });
  }
});

module.exports = router;