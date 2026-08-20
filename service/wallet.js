const { db } = require("../config/firebase");

/**
 * PRODUCTION WALLET SYSTEM
 * - Deposit safe
 * - Duplicate-safe
 * - Supports withdrawals (locked balance ready)
 * - Atomic Firestore transactions
 */

async function creditWallet({ userId, phone, amount, receiptNumber }) {
  if (!userId || !amount || !receiptNumber) {
    throw new Error("Missing wallet credit parameters");
  }

  const amt = Number(amount);
  if (isNaN(amt) || amt <= 0) {
    throw new Error("Invalid amount");
  }

  const walletRef = db.collection("wallets").doc(userId);
  const txRef = db.collection("transactions").doc(receiptNumber);

  try {
    const result = await db.runTransaction(async (transaction) => {

      // 1. DUPLICATE PROTECTION
      const txDoc = await transaction.get(txRef);
      if (txDoc.exists) {
        return { success: true, message: "Already processed" };
      }

      // 2. READ WALLET
      const walletDoc = await transaction.get(walletRef);

      const data = walletDoc.exists ? walletDoc.data() : null;

      const currentBalance = Number(data?.balance || 0);
      const lockedBalance = Number(data?.lockedBalance || 0);
      const totalDeposits = Number(data?.totalDeposits || 0);

      // 3. COMPUTE NEW VALUES
      const newBalance = currentBalance + amt;
      const newTotalDeposits = totalDeposits + amt;
      const availableBalance = newBalance - lockedBalance;

      // 4. WRITE WALLET
      transaction.set(
        walletRef,
        {
          userId,
          phone,

          balance: newBalance,
          lockedBalance: lockedBalance,
          availableBalance: availableBalance,

          totalDeposits: newTotalDeposits,

          currency: "KES",
          status: "active",

          updatedAt: new Date(),
        },
        { merge: true }
      );

      // 5. WRITE TRANSACTION
      transaction.set(txRef, {
        userId,
        phone,
        amount: amt,
        receiptNumber,

        type: "DEPOSIT",
        status: "SUCCESS",

        createdAt: new Date(),
      });

      return {
        success: true,
        message: "Wallet credited successfully",
        balance: newBalance,
      };
    });

    return result;

  } catch (error) {
    console.error("❌ Wallet credit error:", error.message);
    throw error;
  }
}

/**
 * SAFE BALANCE CHECK (for frontend / withdrawal validation)
 */
async function getWallet(userId) {
  const doc = await db.collection("wallets").doc(userId).get();

  if (!doc.exists) {
    return {
      balance: 0,
      availableBalance: 0,
      lockedBalance: 0,
    };
  }

  return doc.data();
}

module.exports = {
  creditWallet,
  getWallet,
};