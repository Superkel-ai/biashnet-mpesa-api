const { db } = require("../config/firebase");
const { processMarketplacePayment } = require("./paymentService");

const { creditWallet } = require("./wallet");
const { saveTransaction } = require("./transactions");
const { createWalletIfNotExists } = require("./walletInit");
const { syncInvestor } = require("./investors");
const { updateInvestmentStats } = require("./investmentStats");

const value = (callback, name) =>
  callback?.CallbackMetadata?.Item?.find(
    x => x.Name === name
  )?.Value;


/*
=========================================================
MARKETPLACE CALLBACK
=========================================================
*/

async function marketplaceCallback(
  doc,
  callback,
  resultCode,
  resultDesc
) {
  const ref = doc.ref;
  const payment = doc.data();

  if (payment.status === "COMPLETED") {
    return {
      handled: true,
      alreadyProcessed: true,
      orderId: payment.orderId,
    };
  }

  if (resultCode !== 0) {
    await ref.update({
      status: "FAILED",
      resultCode,
      resultDesc,
      providerResponse: callback,
      updatedAt: new Date(),
    });

    if (payment.orderId) {
      const orderRef = db
        .collection("marketplaceOrders")
        .doc(payment.orderId);

      const snap = await orderRef.get();

      if (
        snap.exists &&
        snap.data().paymentStatus !== "COMPLETED"
      ) {
        await orderRef.update({
          status: "PENDING_PAYMENT",
          paymentStatus: "FAILED",
          paymentFailureCode: resultCode,
          paymentFailureReason: resultDesc,
          updatedAt: new Date(),
        });
      }
    }

    return {
      handled: true,
      status: "FAILED",
      orderId: payment.orderId,
    };
  }

  const amount = Number(value(callback, "Amount"));
  const receipt = value(callback, "MpesaReceiptNumber");
  const phone = value(callback, "PhoneNumber");

  if (!receipt) {
    await ref.update({
      callbackProcessingStatus: "REQUIRES_REVIEW",
      providerResponse: callback,
      updatedAt: new Date(),
    });

    return {
      handled: true,
      requiresReview: true,
      reason: "MISSING_MPESA_RECEIPT",
    };
  }

  const expected = Number(payment.amount);

  if (
    Number.isFinite(expected) &&
    Math.abs(amount - expected) > 0.01
  ) {
    await ref.update({
      callbackProcessingStatus: "AMOUNT_MISMATCH",
      callbackAmount: amount,
      receiptNumber: receipt,
      providerResponse: callback,
      updatedAt: new Date(),
    });

    return {
      handled: true,
      requiresReview: true,
      reason: "PAYMENT_AMOUNT_MISMATCH",
    };
  }

  let result;

  try {
    result = await processMarketplacePayment({
      orderId: payment.orderId,
      providerTransactionId: receipt,
      amount: amount || payment.amount,
      paymentMethod: "MPESA",
      providerResponse: callback,
    });
  } catch (error) {
    await ref.update({
      callbackProcessingStatus: "PROCESSING_FAILED",
      callbackProcessingError: error.message,
      receiptNumber: receipt,
      callbackAmount: amount,
      providerResponse: callback,
      receivedByPlatform: true,
      updatedAt: new Date(),
    });

    return {
      handled: true,
      requiresReview: true,
      paymentConfirmedByProvider: true,
      reason: "INTERNAL_PROCESSING_FAILED",
    };
  }

  await ref.update({
    status: "COMPLETED",
    resultCode,
    resultDesc,
    receiptNumber: receipt,
    callbackAmount: amount,
    callbackPhoneNumber: phone || null,
    merchantRequestID: callback.MerchantRequestID,
    providerResponse: callback,
    receivedByPlatform: true,
    callbackProcessingStatus: "PROCESSED",
    completedAt: new Date(),
    updatedAt: new Date(),
  });

  return {
    handled: true,
    success: true,
    status: "COMPLETED",
    orderId: payment.orderId,
    receiptNumber: receipt,
    transactionId: result?.transactionId || null,
  };
}


/*
=========================================================
OLD INVESTMENT / WALLET CALLBACK
=========================================================
*/

async function investmentCallback(
  checkoutRequestID,
  callback,
  resultCode,
  resultDesc
) {
  const ref = db
    .collection("pendingTransactions")
    .doc(checkoutRequestID);

  const snap = await ref.get();

  if (!snap.exists) {
    return {
      handled: false,
      reason: "UNKNOWN_PAYMENT",
      checkoutRequestID,
    };
  }

  const pending = snap.data();

  if (pending.status === "SUCCESS") {
    return {
      handled: true,
      alreadyProcessed: true,
    };
  }

  if (resultCode !== 0) {
    await ref.update({
      status: "FAILED",
      resultCode,
      resultDesc,
      callback,
      updatedAt: new Date(),
    });

    return {
      handled: true,
      status: "FAILED",
    };
  }

  const amount =
    Number(value(callback, "Amount")) ||
    Number(pending.amount);

  const receipt =
    value(callback, "MpesaReceiptNumber");

  const phone = String(
    value(callback, "PhoneNumber") ||
    pending.phone ||
    ""
  );

  if (!receipt) {
    await ref.update({
      status: "REQUIRES_REVIEW",
      callback,
      updatedAt: new Date(),
    });

    return {
      handled: true,
      requiresReview: true,
      reason: "MISSING_MPESA_RECEIPT",
    };
  }

  try {
    await createWalletIfNotExists(
      pending.userId,
      phone
    );

    await saveTransaction({
      checkoutRequestID,
      receiptNumber: receipt,
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
      receiptNumber: receipt,
    });

    await syncInvestor(pending.userId);
    await updateInvestmentStats();

    await ref.update({
      status: "SUCCESS",
      receiptNumber: receipt,
      resultCode,
      resultDesc,
      callback,
      updatedAt: new Date(),
    });

    return {
      handled: true,
      success: true,
      status: "SUCCESS",
      userId: pending.userId,
      amount,
      receiptNumber: receipt,
    };
  } catch (error) {
    console.error(
      "Investment payment processing failed:",
      error
    );

    await ref.update({
      status: "PROCESSING_FAILED",
      processingError: error.message,
      receiptNumber: receipt,
      callback,
      updatedAt: new Date(),
    });

    return {
      handled: true,
      requiresReview: true,
      paymentConfirmedByProvider: true,
      reason: "INVESTMENT_PROCESSING_FAILED",
    };
  }
}


/*
=========================================================
MAIN M-PESA CALLBACK
=========================================================
*/

async function processMpesaCallback(body) {
  const callback = body?.Body?.stkCallback;

  if (!callback) {
    return {
      handled: false,
      reason: "INVALID_CALLBACK",
    };
  }

  const checkoutRequestID =
    callback.CheckoutRequestID;

  const resultCode =
    Number(callback.ResultCode);

  const resultDesc =
    callback.ResultDesc || "";

  if (!checkoutRequestID) {
    return {
      handled: false,
      reason: "MISSING_CHECKOUT_REQUEST_ID",
    };
  }

  console.log(
    "🔥 M-PESA CALLBACK:",
    checkoutRequestID,
    resultCode
  );

  /*
  ---------------------------------------------------------
  1. CHECK MARKETPLACE
  ---------------------------------------------------------
  */

  const marketplace = await db
    .collection("marketplacePayments")
    .where(
      "checkoutRequestID",
      "==",
      checkoutRequestID
    )
    .limit(1)
    .get();

  if (!marketplace.empty) {
    return marketplaceCallback(
      marketplace.docs[0],
      callback,
      resultCode,
      resultDesc
    );
  }

  /*
  ---------------------------------------------------------
  2. CHECK OLD INVESTMENT SYSTEM
  ---------------------------------------------------------
  */

  return investmentCallback(
    checkoutRequestID,
    callback,
    resultCode,
    resultDesc
  );
}


module.exports = {
  processMpesaCallback,
};