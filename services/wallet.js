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
    const walletRef = db.collection("wallets").doc(String(phone));j
    const txRef = db.collection("transactions").doc(receiptNumber);

  try {
    // RUN AN ATOMIC TRANSACTION (All reads must happen before any writes)
    const result = await db.runTransaction(async (transaction) => {
      
      // 1. READ TRANSACTION DOC INSIDE THE TX (Anti-Duplicate Check)
      const txDoc = await transaction.get(txRef);
      if (txDoc.exists) {
        console.log("⚠️ Duplicate callback ignored inside transaction:", receiptNumber);
        return { success: true, message: "Already processed" };
      }

      // 2. READ WALLET DOC INSIDE THE TX
      const walletDoc = await transaction.get(walletRef);

      let newBalance = Number(amount);
      if (walletDoc.exists) {
        const current = walletDoc.data().balance || 0;
        newBalance = Number(current) + Number(amount);
      }

      // 3. PERFORM WRITES (Must happen after all reads)
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

      return {
        success: true,
        message: "Wallet updated successfully",
      };
    });

    if (result.message === "Already processed") {
      return result;
    }

    console.log(`✅ Wallet credited: ${phone} +${amount}`);
    return result;

  } catch (error) {
    console.error("❌ Wallet credit error:", error.message);
    throw error;
  }
}

module.exports = { creditWallet };