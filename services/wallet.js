const { db } = require("../config/firebase");

/**
 * CREDIT WALLET (PRODUCTION SAFE)
 * - Uses userId (NOT phone)
 * - Prevents duplicate credit using receiptNumber
 * - Atomic Firestore transaction
 */
async function creditWallet({ userId, phone, amount, receiptNumber }) {
  if (!userId || !amount || !receiptNumber) {
    throw new Error("Missing wallet credit parameters");
  }

  const walletRef = db.collection("wallets").doc(userId);
  const txRef = db.collection("transactions").doc(receiptNumber);

  try {
    const result = await db.runTransaction(async (transaction) => {

      // 1. DUPLICATE CHECK (CRITICAL)
      const txDoc = await transaction.get(txRef);
      if (txDoc.exists) {
        console.log("⚠️ Duplicate transaction ignored:", receiptNumber);
        return { success: true, message: "Already processed" };
      }

      // 2. READ WALLET
      const walletDoc = await transaction.get(walletRef);

      let newBalance = Number(amount);

      if (walletDoc.exists) {
        const current = walletDoc.data().balance || 0;
        newBalance = Number(current) + Number(amount);
      }

      // 3. UPDATE WALLET
      transaction.set(
        walletRef,
        {
          userId,
          phone,
          balance: newBalance,
          updatedAt: new Date(),
        },
        { merge: true }
      );

      // 4. LOG TRANSACTION
      transaction.set(txRef, {
        userId,
        phone,
        amount: Number(amount),
        receiptNumber,
        type: "DEPOSIT",
        status: "SUCCESS",
        createdAt: new Date(),
      });

      return {
        success: true,
        message: "Wallet credited successfully",
      };
    });

    if (result.message === "Already processed") {
      return result;
    }

    console.log(`💰 Wallet credited: ${userId} +${amount}`);
    return result;

  } catch (error) {
    console.error("❌ Wallet credit error:", error.message);
    throw error;
  }
}

module.exports = { creditWallet };