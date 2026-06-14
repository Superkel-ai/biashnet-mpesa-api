const express = require("express");
const router = express.Router();

const { stkPush } = require("../services/mpesa");

// STK Push endpoint
router.post("/stkpush", async (req, res) => {
  try {
    const { phone, amount } = req.body;

    const response = await stkPush(phone, amount);

    res.json({
      success: true,
      message: "STK Push sent",
      data: response,
    });
  } catch (error) {
    console.log(error.response?.data || error.message);

    res.status(500).json({
      success: false,
      message: "STK Push failed",
      error: error.message,
    });
  }
});

module.exports = router;