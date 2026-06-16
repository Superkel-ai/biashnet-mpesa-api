const express = require("express");
const router = express.Router();

const { db } = require("../config/firebase");
const { stkPush } = require("../services/mpesa");

/* =========================================
   STK PUSH
========================================= */
router.post("/stkpush", async (req, res) => {
  try {
    const { userId, phone, amount } = req.body;

    // Validation
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "phone is required",
      });
    }

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "valid amount is required",
      });
    }

    // Send STK Push
    const response = await stkPush(
      phone,
      Number(amount)
    );

    const checkoutRequestID =
      response.CheckoutRequestID ||
      response.data?.CheckoutRequestID;

    if (!checkoutRequestID) {
      throw new Error(
        "CheckoutRequestID missing from M-Pesa response"
      );
    }

    // Save pending transaction
    await db
      .collection("pendingTransactions")
      .doc(checkoutRequestID)
      .set({
        checkoutRequestID,

        userId,

        phone,

        amount: Number(amount),

        status: "PENDING",

        createdAt: new Date(),

        updatedAt: new Date(),
      });

    console.log(
      `🟡 Pending transaction created: ${checkoutRequestID}`
    );

    return res.status(200).json({
      success: true,
      message: "STK Push sent",

      checkoutRequestID,

      data: response,
    });
  } catch (error) {
    console.error(
      "❌ STK Error:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      success: false,
      message: "STK Push failed",
      error:
        error.response?.data || error.message,
    });
  }
});

module.exports = router;