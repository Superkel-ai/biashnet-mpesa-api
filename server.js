const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { db } = require("./config/firebase");
const { creditWallet } = require("./services/wallet");
const { saveTransaction } = require("./services/transactions");
const { createWalletIfNotExists } = require("./services/walletInit");
const {
syncInvestor
} = require(
"./services/investors"
);

const {
updateInvestmentStats
} = require(
"./services/investmentStats"
);
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
    app: "Biashnet Payment API",
    status: "LIVE",
  });
});

/* =========================
   ROUTES
========================= */
app.use("/api", stkRoutes);
app.use("/api", withdrawRoutes);

/* =========================
   INTASEND PAYMENT CALLBACK
========================= */
app.post("/callback", async (req, res) => {
  try {

    console.log(
      "🔥 INTASEND CALLBACK:",
      JSON.stringify(req.body, null, 2)
    );

    const data = req.body;

    if (!data) {
      return res.sendStatus(200);
    }


    // IntaSend sends invoice/payment details
    const apiRef =
      data.api_ref ||
      data.invoice?.api_ref ||
      data.reference;


    if (!apiRef) {
      console.log("No payment reference found");
      return res.sendStatus(200);
    }


    const pendingRef = db
      .collection("pendingTransactions")
      .doc(apiRef);


    const pendingDoc = await pendingRef.get();


    if (!pendingDoc.exists) {
      console.log("Pending transaction not found:", apiRef);
      return res.sendStatus(200);
    }


    const pending = pendingDoc.data();


    // Check payment status
    const status =
      data.state ||
      data.status;


    if (
      status !== "COMPLETE" &&
      status !== "SUCCESSFUL" &&
      status !== "SUCCESS"
    ) {

      await pendingRef.update({
        status: "FAILED",
        callback: data,
        updatedAt: new Date()
      });

      return res.sendStatus(200);
    }



    const amount =
      Number(data.amount) ||
      pending.amount;


    const receiptNumber =
      data.mpesa_reference ||
      data.reference ||
      `INTASEND_${apiRef}`;



    await createWalletIfNotExists(
      pending.userId,
      pending.phone
    );


    await saveTransaction({
      checkoutRequestID: apiRef,
      receiptNumber,
      userId: pending.userId,
      phone: pending.phone,
      amount,
      type: "DEPOSIT",
      status: "SUCCESS",
      provider: "INTASEND"
    });


if (pending.status === "SUCCESS") {
  console.log("Already processed:", apiRef);
  return res.sendStatus(200);
}
    await creditWallet({
      userId: pending.userId,
      phone: pending.phone,
      amount,
      receiptNumber
    });



    await syncInvestor(
      pending.userId
    );


    await updateInvestmentStats();



    await pendingRef.update({
      status: "SUCCESS",
      receiptNumber,
      callback: data,
      updatedAt: new Date()
    });



    console.log(
      "✅ Wallet credited:",
      pending.userId,
      amount
    );


    return res.sendStatus(200);


  } catch (err) {

    console.error(
      "❌ IntaSend callback error:",
      err
    );

    return res.sendStatus(200);
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