const { db } = require("../config/firebase");

/**
 * SAFE WALLET CREDIT SYSTEM
 * - prevents double payments (idempotent)
 * - safe for M-Pesa callback retries
 * - atomic updates using Firestore transaction
 */
async function creditWallet({ phone, amount, receiptNumber }) {
  if (!phone || !amount || !receiptNumber) {
    throw new Error("Missing wallet credit parameters");
  }

  const walletRef = db.collection("wallets").doc(phone);
  const txRef = db.collection("transactions").doc(receiptNumber);

  try {
    // 1. CHECK IF TRANSACTION ALREADY PROCESSED (ANTI-DUPLICATE)
    const existingTx = await txRef.get();

    if (existingTx.exists) {
      console.log("⚠️ Duplicate callback ignored:", receiptNumber);
      return { success: true, message: "Already processed" };
    }

    // 2. ATOMIC TRANSACTION (SAFE BALANCE UPDATE)
    await db.runTransaction(async (transaction) => {
      const walletDoc = await transaction.get(walletRef);

      let newBalance = Number(amount);

      if (walletDoc.exists) {
        const current = walletDoc.data().balance || 0;
        newBalance = Number(current) + Number(amount);
      }

      // Update wallet
      transaction.set(
        walletRef,
        {
          phone,
          balance: newBalance,
          updatedAt: new Date(),
        },
        { merge: true }
      );

      // Log transaction (IMPORTANT for audit)
      transaction.set(txRef, {
        phone,
        amount: Number(amount),
        receiptNumber,
        type: "CREDIT",
        status: "SUCCESS",
        createdAt: new Date(),
      });
    });

    console.log(`✅ Wallet credited: ${phone} +${amount}`);

    return {
      success: true,
      message: "Wallet updated successfully",
    };
  } catch (error) {
    console.error("❌ Wallet credit error:", error.message);
    throw error;
  }
}

module.exports = { creditWallet };