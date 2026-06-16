const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { db } = require("./config/firebase");
const { creditWallet } = require("./services/wallet");
const { saveTransaction } = require("./services/transactions");
const { createWalletIfNotExists } = require("./services/walletInit");

const stkRoutes = require("./routes/stk");
const withdrawRoutes = require("./routes/withdraw");

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
    app: "Biashnet M-Pesa API",
    status: "LIVE",
  });
});

/* =========================
   ROUTES
========================= */
app.use("/api", stkRoutes);
app.use("/api", withdrawRoutes);

/* =========================
   MPESA STK CALLBACK
========================= */
app.post("/callback", async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;

    if (!callback) return res.json({ ResultCode: 0 });

    const checkoutRequestID = callback.CheckoutRequestID;
    const resultCode = callback.ResultCode;

    const pendingRef = db.collection("pendingTransactions").doc(checkoutRequestID);
    const pendingDoc = await pendingRef.get();

    if (!pendingDoc.exists) {
      console.log("Pending not found");
      return res.json({ ResultCode: 0 });
    }

    const pending = pendingDoc.data();

    if (resultCode !== 0) {
      await pendingRef.update({ status: "FAILED" });
      return res.json({ ResultCode: 0 });
    }

   let amount = requestedAmount;
let receiptNumber = "";

const items = callback.CallbackMetadata?.Item || [];

items.forEach((item) => {
  if (item.Name === "Amount") {
    amount = Number(item.Value);
  }

  if (item.Name === "MpesaReceiptNumber") {
    receiptNumber = String(item.Value);
  }
});

// 🔥 SAFE FALLBACK (VERY IMPORTANT)
if (!receiptNumber) {
  console.warn("⚠️ Missing MpesaReceiptNumber, using fallback");
  receiptNumber = `MPESA_${checkoutRequestID}`;
}
    await createWalletIfNotExists(pending.userId, pending.phone);

    await saveTransaction({
      transactionId: receiptNumber,
      userId: pending.userId,
      phone: pending.phone,
      amount,
      type: "DEPOSIT",
      status: "SUCCESS",
    });

    await creditWallet({
      userId: pending.userId,
      phone: pending.phone,
      amount,
      receiptNumber,
    });

    await pendingRef.update({
      status: "SUCCESS",
      receiptNumber,
    });

    return res.json({ ResultCode: 0 });
  } catch (err) {
    console.error(err);
    return res.json({ ResultCode: 0 });
  }
});

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