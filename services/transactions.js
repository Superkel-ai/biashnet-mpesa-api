const { db } = require("../config/firebase");

/**
 * SAFE TRANSACTION SAVER (IDEMPOTENT + ATOMIC)
 * - prevents duplicate M-Pesa callbacks
 * - safe under retries
 * - structured logging for audits
 */
async function saveTransaction(data) {
  try {
    if (!data) {
      throw new Error("Transaction data is required");
    }

    const {
      checkoutRequestID,
      receiptNumber,
      phone,
      amount,
      status = "PENDING",
      type = "STK",
    } = data;

    // Use BEST unique ID available
    const txId = checkoutRequestID || receiptNumber;

    if (!txId) {
      throw new Error("Missing transaction ID");
    }

    const ref = db.collection("transactions").doc(txId);

    // RUN AN ATOMIC TRANSACTION (Prevents concurrent race conditions)
    const savedNew = await db.runTransaction(async (transaction) => {
      
      // 1. CHECK DUPLICATE INSIDE THE TRANSACTION
      const existing = await transaction.get(ref);

      if (existing.exists) {
        console.log("⚠️ Duplicate transaction ignored:", txId);
        return false; // Returns false out of the transaction block
      }

      // 2. SAVE TRANSACTION SAFELY INSIDE THE TRANSACTION
      transaction.set(ref, {
        checkoutRequestID,
        receiptNumber: receiptNumber || null,
        phone: phone || null,
        amount: amount ? Number(amount) : null,
        status,
        type,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return true;
    });

    if (savedNew) {
      console.log("✅ Transaction saved:", txId);
    }

    return savedNew;
  } catch (error) {
    console.error("❌ saveTransaction error:", error.message);
    throw error;
  }
}

module.exports = { saveTransaction };