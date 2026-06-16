const { db } = require("../config/firebase");
const { sendB2C } = require("./b2c");
const { FieldValue } = require("firebase-admin/firestore");

/**
 * PRODUCTION WITHDRAWAL APPROVAL ENGINE
 * - idempotent
 * - safe against double payout
 * - wallet-safe
 * - audit ready
 */
async function approveWithdrawal(withdrawalId) {
  const withdrawalRef = db.collection("withdrawalRequests").doc(withdrawalId);

  // =========================
  // 1. ATOMIC LOCK PHASE
  // =========================
  const withdrawalData = await db.runTransaction(async (tx) => {
    const doc = await tx.get(withdrawalRef);

    if (!doc.exists) {
      throw new Error("Withdrawal not found");
    }

    const data = doc.data();

    // 🚨 prevent double processing
    if (data.status !== "PENDING") {
      throw new Error(`Already processed: ${data.status}`);
    }

    // lock it
    tx.update(withdrawalRef, {
      status: "PROCESSING",
      updatedAt: new Date(),
    });

    return data;
  });

  // =========================
  // 2. SAFARICOM B2C CALL
  // =========================
  try {
    const b2cRes = await sendB2C({
      phone: withdrawalData.phone,
      amount: withdrawalData.netAmount || withdrawalData.amount,
      remarks: "Marketplace Withdrawal",
    });

    // =========================
    // 3. MARK SENT (SAFE STATE)
    // =========================
    await withdrawalRef.update({
      status: "SENT",
      mpesaResponse: b2cRes,
      updatedAt: new Date(),
      sentAt: new Date(),
    });

    // =========================
    // 4. AUDIT LOG (IMPORTANT)
    // =========================
    await db.collection("withdrawalLogs").add({
      withdrawalId,
      userId: withdrawalData.userId,
      phone: withdrawalData.phone,
      amount: withdrawalData.amount,
      status: "SENT",
      createdAt: new Date(),
    });

    console.log("✅ Withdrawal SENT:", withdrawalId);

    return {
      success: true,
      message: "B2C sent successfully",
      data: b2cRes,
    };

  } catch (error) {
    console.error("❌ B2C failed:", error.message);

    // =========================
    // 5. FAILURE HANDLING
    // =========================

    await withdrawalRef.update({
      status: "FAILED",
      failureReason: error.message,
      updatedAt: new Date(),
    });

    // OPTIONAL SAFETY: restore locked funds (if you use lockedBalance)
    await db.collection("wallets").doc(withdrawalData.userId).update({
      lockedBalance: FieldValue.increment(-withdrawalData.amount),
      updatedAt: new Date(),
    });

    // audit log
    await db.collection("withdrawalLogs").add({
      withdrawalId,
      userId: withdrawalData.userId,
      status: "FAILED",
      reason: error.message,
      createdAt: new Date(),
    });

    return {
      success: false,
      message: error.message,
    };
  }
}

module.exports = { approveWithdrawal };