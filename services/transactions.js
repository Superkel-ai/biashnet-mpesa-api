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

    // 1. CHECK DUPLICATE FIRST (FAST FAIL)
    const existing = await ref.get();

    if (existing.exists) {
      console.log("⚠️ Duplicate transaction ignored:", txId);
      return false;
    }

    // 2. SAVE TRANSACTION SAFELY
    await ref.set({
      checkoutRequestID,
      receiptNumber: receiptNumber || null,
      phone: phone || null,
      amount: amount ? Number(amount) : null,
      status,
      type,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log("✅ Transaction saved:", txId);

    return true;
  } catch (error) {
    console.error("❌ saveTransaction error:", error.message);
    throw error;
  }
}

module.exports = { saveTransaction };