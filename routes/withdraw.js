const express = require("express");
const router = express.Router();

const { requestWithdrawal } = require("../services/withdraw");

/**
 * PRODUCTION WITHDRAW ROUTE
 * - secure
 * - validated
 * - safe for real money
 */

router.post("/withdraw", async (req, res) => {
  try {
    const { userId, phone, amount, idempotencyKey } = req.body;

    // 1. BASIC VALIDATION
    if (!userId || !phone || !amount) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount",
      });
    }

    if (amount < 10) {
      return res.status(400).json({
        success: false,
        message: "Minimum withdrawal is 10",
      });
    }

    // 2. CALL SERVICE
    const result = await requestWithdrawal({
      userId,
      phone,
      amount: Number(amount),
      idempotencyKey,
    });

    return res.json(result);

  } catch (err) {
    console.error("❌ Withdraw error:", err.message);

    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;