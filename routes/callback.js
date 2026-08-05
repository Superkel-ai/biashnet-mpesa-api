const express = require("express");
const router = express.Router();

const { db } = require("../config/firebase");
const { creditWallet } = require("../services/wallet");
const { saveTransaction } = require("../services/transactions");
const { createWalletIfNotExists } = require("../services/walletInit");
const { syncInvestor } = require("../services/investors");
const { updateInvestmentStats } = require("../services/investmentStats");

/* =========================
   M-PESA STK CALLBACK
========================= */
router.post("/stk/callback", async (req, res) => {
  try {
    console.log(
      "🔥 M-PESA CALLBACK:",
      JSON.stringify(req.body, null, 2)
    );

    const callback = req.body?.Body?.stkCallback;

    if (!callback) {
      return res.sendStatus(200);
    }

    const checkoutRequestID = callback.CheckoutRequestID;
    const resultCode = callback.ResultCode;

    const pendingRef = db
      .collection("pendingTransactions")
      .doc(checkoutRequestID);

    const pendingDoc = await pendingRef.get();

    if (!pendingDoc.exists) {
      console.log(
        "Pending transaction not found:",
        checkoutRequestID
      );
      return res.sendStatus(200);
    }

    const pending = pendingDoc.data();

    // Payment failed
    if (resultCode !== 0) {
      await pendingRef.update({
        status: "FAILED",
        callback,
        updatedAt: new Date(),
      });

      return res.sendStatus(200);
    }

    // Read callback metadata
    const items = callback.CallbackMetadata?.Item || [];

    const getValue = (name) =>
      items.find((i) => i.Name === name)?.Value;

    const amount =
      Number(getValue("Amount")) ||
      pending.amount;

    const receiptNumber =
      getValue("MpesaReceiptNumber");

    const phone =
      String(getValue("PhoneNumber"));

    // Prevent duplicate processing
    if (pending.status === "SUCCESS") {
      console.log(
        "Already processed:",
        checkoutRequestID
      );

      return res.sendStatus(200);
    }

    await createWalletIfNotExists(
      pending.userId,
      phone
    );

    await saveTransaction({
      checkoutRequestID,
      receiptNumber,
      userId: pending.userId,
      phone,
      amount,
      type: "DEPOSIT",
      status: "SUCCESS",
      provider: "MPESA",
    });

    await creditWallet({
      userId: pending.userId,
      phone,
      amount,
      receiptNumber,
    });

    await syncInvestor(
      pending.userId
    );

    await updateInvestmentStats();

    await pendingRef.update({
      status: "SUCCESS",
      receiptNumber,
      callback,
      updatedAt: new Date(),
    });

    console.log(
      "✅ Wallet credited:",
      pending.userId,
      amount
    );

    return res.sendStatus(200);

  } catch (err) {
    console.error(
      "❌ M-PESA Callback Error:",
      err
    );

    return res.sendStatus(200);
  }
});

module.exports = router;