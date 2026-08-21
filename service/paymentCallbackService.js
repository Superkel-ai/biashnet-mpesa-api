const {
  db,
} = require("../config/firebase");

const {
  COLLECTIONS,
} = require("../config/collections");

const {
  PAYMENT_STATUS,
} = require("../config/paymentConstants");

const {
  processMarketplacePayment,
  markPaymentFailed,
} = require("./paymentService");

const {
  creditWallet,
} = require("./wallet");

const {
  saveTransaction,
} = require("./transactions");

const {
  createWalletIfNotExists,
} = require("./walletInit");

const {
  syncInvestor,
} = require("./investors");

const {
  updateInvestmentStats,
} = require("./investmentStats");


/*
=========================================================
CALLBACK METADATA HELPER
=========================================================
*/

function value(callback, name) {

  return callback
    ?.CallbackMetadata
    ?.Item
    ?.find(item =>
      item.Name === name
    )
    ?.Value;

}


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

  const ref =
    doc.ref;

  const payment =
    doc.data();


  /*
  =======================================================
  ALREADY COMPLETED
  =======================================================
  */

  if (
    payment.status ===
    PAYMENT_STATUS.COMPLETED
  ) {

    return {

      handled: true,

      alreadyProcessed: true,

      orderId:
        payment.orderId,

      paymentId:
        payment.paymentId,

    };

  }


  /*
  =======================================================
  FAILED / CANCELLED M-PESA PAYMENT
  =======================================================
  */

  if (
    resultCode !== 0
  ) {

    try {

      const result =
        await markPaymentFailed({

          paymentId:
            payment.paymentId ||
            doc.id,

          resultCode,

          resultDescription:
            resultDesc,

          providerResponse:
            callback,

        });

      return {

        handled: true,

        success: false,

        status:
          PAYMENT_STATUS.FAILED,

        orderId:
          payment.orderId,

        paymentId:
          payment.paymentId ||
          doc.id,

        resultCode,

        resultDesc,

        ...result,

      };

    } catch (error) {

      await ref.update({

        callbackProcessingStatus:
          "PROCESSING_FAILED",

        callbackProcessingError:
          error.message,

        resultCode,

        resultDesc,

        providerResponse:
          callback,

        receivedByPlatform:
          true,

        updatedAt:
          new Date(),

      });

      return {

        handled: true,

        requiresReview: true,

        paymentConfirmedByProvider:
          false,

        reason:
          "PAYMENT_FAILURE_PROCESSING_FAILED",

      };

    }

  }


  /*
  =======================================================
  SUCCESS CALLBACK DATA
  =======================================================
  */

  const amount =
    Number(
      value(
        callback,
        "Amount"
      )
    );

  const receipt =
    value(
      callback,
      "MpesaReceiptNumber"
    );

  const phone =
    value(
      callback,
      "PhoneNumber"
    );


  /*
  =======================================================
  RECEIPT VALIDATION
  =======================================================
  */

  if (!receipt) {

    await ref.update({

      callbackProcessingStatus:
        "REQUIRES_REVIEW",

      callbackProcessingError:
        "Missing M-PESA receipt number.",

      providerResponse:
        callback,

      receivedByPlatform:
        true,

      updatedAt:
        new Date(),

    });

    return {

      handled: true,

      requiresReview: true,

      reason:
        "MISSING_MPESA_RECEIPT",

    };

  }


  /*
  =======================================================
  AMOUNT VALIDATION
  =======================================================
  */

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {

    await ref.update({

      callbackProcessingStatus:
        "AMOUNT_INVALID",

      callbackAmount:
        amount,

      receiptNumber:
        receipt,

      providerResponse:
        callback,

      receivedByPlatform:
        true,

      updatedAt:
        new Date(),

    });

    return {

      handled: true,

      requiresReview: true,

      reason:
        "INVALID_CALLBACK_AMOUNT",

    };

  }


  /*
  =======================================================
  SERVER-SIDE AMOUNT CHECK
  =======================================================
  */

  const expected =
    Number(
      payment.amount
    );

  if (
    !Number.isFinite(expected) ||
    Math.abs(
      amount - expected
    ) > 0.01
  ) {

    await ref.update({

      callbackProcessingStatus:
        "AMOUNT_MISMATCH",

      callbackAmount:
        amount,

      receiptNumber:
        receipt,

      providerResponse:
        callback,

      receivedByPlatform:
        true,

      updatedAt:
        new Date(),

    });

    return {

      handled: true,

      requiresReview: true,

      reason:
        "PAYMENT_AMOUNT_MISMATCH",

    };

  }


  /*
  =======================================================
  PROCESS MARKETPLACE PAYMENT
  =======================================================

  This is the important hand-off.

  paymentService now performs the atomic
  marketplace payment processing:

  Payment
      ↓
  Order
      ↓
  Stock
      ↓
  Seller funds
  =======================================================
  */

  let result;

  try {

    result =
      await processMarketplacePayment({

        orderId:
          payment.orderId,

        providerTransactionId:
          receipt,

        amount,

        paymentMethod:
          "MPESA",

        providerResponse:
          callback,

      });

  } catch (error) {

    console.error(
      "❌ Marketplace payment processing failed:",
      error
    );

    await ref.update({

      callbackProcessingStatus:
        "PROCESSING_FAILED",

      callbackProcessingError:
        error.message,

      receiptNumber:
        receipt,

      callbackAmount:
        amount,

      callbackPhoneNumber:
        phone || null,

      providerResponse:
        callback,

      receivedByPlatform:
        true,

      updatedAt:
        new Date(),

    });

    return {

      handled: true,

      requiresReview: true,

      paymentConfirmedByProvider:
        true,

      reason:
        "INTERNAL_PROCESSING_FAILED",

    };

  }


  /*
  =======================================================
  SAVE CALLBACK INFORMATION
  =======================================================
  */

  await ref.update({

    status:
      PAYMENT_STATUS.COMPLETED,

    resultCode,

    resultDescription:
      resultDesc,

    receiptNumber:
      receipt,

    callbackAmount:
      amount,

    callbackPhoneNumber:
      phone || null,

    merchantRequestId:
      callback.MerchantRequestID ||
      payment.merchantRequestId ||
      null,

    checkoutRequestId:
      callback.CheckoutRequestID ||
      payment.checkoutRequestId ||
      null,

    providerResponse:
      callback,

    receivedByPlatform:
      true,

    callbackProcessingStatus:
      "PROCESSED",

    completedAt:
      new Date(),

    updatedAt:
      new Date(),

  });


  /*
  =======================================================
  SUCCESS
  =======================================================
  */

  return {

    handled: true,

    success: true,

    alreadyProcessed:
      result?.alreadyProcessed ||
      false,

    status:
      PAYMENT_STATUS.COMPLETED,

    orderId:
      payment.orderId,

    paymentId:
      payment.paymentId ||
      doc.id,

    receiptNumber:
      receipt,

    transactionId:
      result?.providerTransactionId ||
      receipt,

  };

}


/*
=========================================================
LEGACY INVESTMENT / WALLET CALLBACK
=========================================================
*/

async function investmentCallback(
  checkoutRequestID,
  callback,
  resultCode,
  resultDesc
) {

  const ref =
    db
      .collection(
        COLLECTIONS.PENDING_TRANSACTIONS
      )
      .doc(
        checkoutRequestID
      );


  const snap =
    await ref.get();


  if (!snap.exists) {

    return {

      handled: false,

      reason:
        "UNKNOWN_PAYMENT",

      checkoutRequestID,

    };

  }


  const pending =
    snap.data();


  if (
    pending.status ===
    "SUCCESS"
  ) {

    return {

      handled: true,

      alreadyProcessed: true,

    };

  }


  /*
  =======================================================
  FAILED PAYMENT
  =======================================================
  */

  if (
    resultCode !== 0
  ) {

    await ref.update({

      status:
        "FAILED",

      resultCode,

      resultDesc,

      callback,

      updatedAt:
        new Date(),

    });

    return {

      handled: true,

      status:
        "FAILED",

    };

  }


  /*
  =======================================================
  PAYMENT DATA
  =======================================================
  */

  const amount =
    Number(
      value(
        callback,
        "Amount"
      )
    ) ||
    Number(
      pending.amount
    );


  const receipt =
    value(
      callback,
      "MpesaReceiptNumber"
    );


  const phone =
    String(
      value(
        callback,
        "PhoneNumber"
      ) ||
      pending.phone ||
      ""
    );


  /*
  =======================================================
  RECEIPT VALIDATION
  =======================================================
  */

  if (!receipt) {

    await ref.update({

      status:
        "REQUIRES_REVIEW",

      callback,

      updatedAt:
        new Date(),

    });

    return {

      handled: true,

      requiresReview: true,

      reason:
        "MISSING_MPESA_RECEIPT",

    };

  }


  /*
  =======================================================
  PROCESS LEGACY INVESTMENT
  =======================================================
  */

  try {

    await createWalletIfNotExists(
      pending.userId,
      phone
    );


    await saveTransaction({

      checkoutRequestID,

      receiptNumber:
        receipt,

      userId:
        pending.userId,

      phone,

      amount,

      type:
        "DEPOSIT",

      status:
        "SUCCESS",

      provider:
        "MPESA",

    });


    await creditWallet({

      userId:
        pending.userId,

      phone,

      amount,

      receiptNumber:
        receipt,

    });


    await syncInvestor(
      pending.userId
    );


    await updateInvestmentStats();


    await ref.update({

      status:
        "SUCCESS",

      receiptNumber:
        receipt,

      resultCode,

      resultDesc,

      callback,

      updatedAt:
        new Date(),

    });


    return {

      handled: true,

      success: true,

      status:
        "SUCCESS",

      userId:
        pending.userId,

      amount,

      receiptNumber:
        receipt,

    };

  } catch (error) {

    console.error(
      "Investment payment processing failed:",
      error
    );


    await ref.update({

      status:
        "PROCESSING_FAILED",

      processingError:
        error.message,

      receiptNumber:
        receipt,

      callback,

      updatedAt:
        new Date(),

    });


    return {

      handled: true,

      requiresReview: true,

      paymentConfirmedByProvider:
        true,

      reason:
        "INVESTMENT_PROCESSING_FAILED",

    };

  }

}


/*
=========================================================
FIND MARKETPLACE PAYMENT
=========================================================

Uses the new field first.

Also supports old documents using:

checkoutRequestID
=========================================================
*/

async function findMarketplacePayment(
  checkoutRequestId
) {

  let snapshot =
    await db
      .collection(
        COLLECTIONS.PAYMENTS
      )
      .where(
        "checkoutRequestID",
        "==",
        checkoutRequestID
      )
      .limit(1)
      .get();


  if (!snapshot.empty)
    return snapshot.docs[0];


  /*
  -------------------------------------------------------
  OLD FIELD COMPATIBILITY
  -------------------------------------------------------
  */

  snapshot =
    await db
      .collection(
        COLLECTIONS.PAYMENTS
      )
      .where(
        "checkoutRequestId",
        "==",
        checkoutRequestID
      )
      .limit(1)
      .get();


  if (snapshot.empty)
    return null;


  return snapshot.docs[0];

}


/*
=========================================================
MAIN M-PESA CALLBACK
=========================================================
*/

async function processMpesaCallback(
  body
) {

  const callback =
    body?.Body?.stkCallback;


  if (!callback) {

    return {

      handled: false,

      reason:
        "INVALID_CALLBACK",

    };

  }


  const checkoutRequestID =
    callback.CheckoutRequestID;


  const resultCode =
    Number(
      callback.ResultCode
    );


  const resultDesc =
    callback.ResultDesc ||
    "";


  if (!checkoutRequestID) {

    return {

      handled: false,

      reason:
        "MISSING_CHECKOUT_REQUEST_ID",

    };

  }


  console.log(
    "🔥 M-PESA CALLBACK:",
    checkoutRequestID,
    resultCode
  );


  /*
  =======================================================
  1. FIND MARKETPLACE PAYMENT
  =======================================================
  */

  const marketplaceDoc =
    await findMarketplacePayment(
      checkoutRequestID
    );


  if (marketplaceDoc) {

    return marketplaceCallback(

      marketplaceDoc,

      callback,

      resultCode,

      resultDesc

    );

  }


  /*
  =======================================================
  2. FALL BACK TO LEGACY INVESTMENT
  =======================================================
  */

  return investmentCallback(

    checkoutRequestID,

    callback,

    resultCode,

    resultDesc

  );

}


/*
=========================================================
EXPORT
=========================================================
*/

module.exports = {

  processMpesaCallback,

};