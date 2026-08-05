const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { db } = require("./config/firebase");
const stkRoutes = require("./routes/stk");
const withdrawRoutes = require("./routes/withdraw");
const callbackRoutes = require("./routes/callback");
const app = express();

/* =========================
   MIDDLEWARE
========================= */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
   ROUTES
========================= */
app.use("/api", stkRoutes);
app.use("/api", withdrawRoutes);
app.use("/api", callbackRoutes);

/* =========================
   B2C CALLBACK (WITHDRAWALS)
========================= */
app.post("/b2c/result", async (req, res) => {
  try {
    const result = req.body?.Result;
    if (!result) return res.send("OK");

    const transactionId = result.TransactionID;
    const resultCode = result.ResultCode;

    const snap = await db.collection("withdrawalRequests")
      .where("transactionId", "==", transactionId)
      .limit(1)
      .get();

    if (snap.empty) return res.send("OK");

    const doc = snap.docs[0];
    const data = doc.data();

    if (resultCode === 0) {
      await doc.ref.update({ status: "PAID" });
    } else {
      await db.collection("wallets").doc(data.userId).update({
        lockedBalance: (data.lockedBalance || 0) - data.amount,
      });

      await doc.ref.update({ status: "FAILED" });
    }

    return res.send("OK");
  } catch (err) {
    console.error(err);
    return res.send("OK");
  }
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});