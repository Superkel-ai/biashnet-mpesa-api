const express = require("express");
const cors = require("cors");
require("dotenv").config();

const stkRoutes = require("./routes/stk");

const app = express();

/**
 * =========================
 * MIDDLEWARE
 * =========================
 */
app.use(cors());
app.use(express.json());

/**
 * =========================
 * HEALTH CHECK (Railway uses this)
 * =========================
 */
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "🚀 Biashnet M-Pesa API is LIVE",
    environment: process.env.NODE_ENV || "development",
  });
});

/**
 * =========================
 * API ROUTES
 * =========================
 */
app.use("/api", stkRoutes);

/**
 * =========================
 * CALLBACK (Safaricom hits here)
 * =========================
 */
app.post("/callback", (req, res) => {
  try {
    console.log("📩 M-Pesa Callback Received:");

    const body = req.body;

    console.log(JSON.stringify(body, null, 2));

    // FUTURE LOGIC (we will add later):
    // 1. verify payment success
    // 2. update order in Firestore
    // 3. credit seller wallet
    // 4. calculate commission

    res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Accepted",
    });
  } catch (error) {
    console.error("Callback Error:", error.message);

    res.status(500).json({
      ResultCode: 1,
      ResultDesc: "Failed",
    });
  }
});

/**
 * =========================
 * GLOBAL ERROR HANDLER
 * =========================
 */
app.use((err, req, res, next) => {
  console.error("🔥 Server Error:", err);

  res.status(500).json({
    success: false,
    message: "Internal Server Error",
  });
});

/**
 * =========================
 * START SERVER (Railway compatible)
 * =========================
 */
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "🚀 Biashnet M-Pesa API is LIVE",
    environment: process.env.NODE_ENV || "development",
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Biashnet API running on port ${PORT}`);
});