const { db } = require("../config/firebase");
const { v4: uuidv4 } = require("uuid");
const { FieldValue } = require("firebase-admin/firestore");

async function requestWithdrawal({ userId, phone, amount }) {
  if (!userId || !phone || !amount) {
    throw new Error("Missing withdrawal parameters");
  }

  const requestId = uuidv4();

  const walletRef = db.collection("wallets").doc(userId);
  const withdrawRef = db.collection("withdrawRequests").doc(requestId);

  await db.runTransaction(async (tx) => {
    const walletDoc = await tx.get(walletRef);

    if (!walletDoc.exists) {
      throw new Error("Wallet not found");
    }

    const wallet = walletDoc.data();

    const balance = wallet.balance || 0;
    const locked = wallet.lockedBalance || 0;

    const available = balance - locked;

    if (available < amount) {
      throw new Error("Insufficient available balance");
    }

    const fee = Math.ceil(amount * 0.02);
    const netAmount = amount - fee;

    // 🔒 LOCK FUNDS (NOT DEDUCT YET)
    tx.update(walletRef, {
      lockedBalance: FieldValue.increment(amount),
      updatedAt: new Date(),
    });

    // 📦 CREATE WITHDRAW REQUEST
    tx.set(withdrawRef, {
      requestId,
      userId,
      phone,
      amount,
      fee,
      netAmount,
      status: "PENDING",
      createdAt: new Date(),
    });
  });

  return {
    success: true,
    requestId,
    message: "Withdrawal request created",
  };
}

module.exports = { requestWithdrawal };