const { db } = require("../config/firebase");

async function createWalletIfNotExists(userId, phone) {
  const ref = db.collection("wallets").doc(userId);
  const doc = await ref.get();

  if (!doc.exists) {
    await ref.set({
      userId,
      phone,
      balance: 0,
      lockedBalance: 0,
      availableBalance: 0,
      currency: "KES",
      status: "active",
      totalDeposits: 0,
      totalWithdrawals: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

module.exports = { createWalletIfNotExists };