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
    let { userId, phone, amount } = req.body;

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
    // CALL M-PESA
    // =========================
    const response = await stkPush(phone, amount);

    const checkoutRequestID =
      response.CheckoutRequestID || response.data?.CheckoutRequestID;

    if (!checkoutRequestID) {
      throw new Error("CheckoutRequestID missing from M-Pesa response");
    }

    // =========================
    // SAVE PENDING TX (IDEMPOTENT)
    // =========================
    await db
      .collection("pendingTransactions")
      .doc(checkoutRequestID)
      .set(
        {
          checkoutRequestID,
          userId,
          phone,
          amount,
          requestId,
          status: "PENDING",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { merge: true }
      );

    console.log("🟡 Pending transaction created:", checkoutRequestID);

    return res.status(200).json({
      success: true,
      message: "STK Push sent",
      checkoutRequestID,
      requestId,
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