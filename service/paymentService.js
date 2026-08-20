const {
  db,
  FieldValue,
} = require("../config/firebase");

const {
  COLLECTIONS,
} = require("../config/collections");

const {
  PAYMENT_STATUS,
  ORDER_PAYMENT_STATUS,
} = require("../config/paymentConstants");

const {
  calculateCommission,
} = require("./commissionService");


/*
=========================================================
PAYMENT SERVICE
=========================================================

Central payment business logic.

Responsibilities:

1. Create payment record
2. Get payment
3. Update payment
4. Mark payment as successful
5. Mark payment as failed
6. Validate payment amount
7. Prevent duplicate payments
8. Connect payment -> order
9. Prepare financial information

IMPORTANT:

This service does NOT:

- Call Safaricom directly
- Generate STK requests
- Handle HTTP requests
- Handle Express req/res

Those responsibilities belong to:

darajaService.js
paymentInitiationService.js
paymentCallbackService.js
paymentController.js
=========================================================
*/


/*
=========================================================
CREATE PAYMENT
=========================================================
*/

async function createPayment({

  paymentId,

  orderId,

  buyerId,

  sellerId,

  amount,

  phoneNumber,

  paymentMethod = "MPESA",

}) {

  if (!paymentId) {

    throw new Error(
      "Payment ID is required."
    );

  }


  if (!orderId) {

    throw new Error(
      "Order ID is required."
    );

  }


  if (!buyerId) {

    throw new Error(
      "Buyer ID is required."
    );

  }


  const numericAmount =
    Number(amount);


  if (
    !Number.isFinite(numericAmount) ||
    numericAmount <= 0
  ) {

    throw new Error(
      "Invalid payment amount."
    );

  }


  const paymentRef =
    db
      .collection(
        COLLECTIONS.PAYMENTS
      )
      .doc(paymentId);


  const existing =
    await paymentRef.get();


  /*
  -------------------------------------------------------
  IDEMPOTENCY
  -------------------------------------------------------
  */

  if (existing.exists) {

    return {

      created: false,

      paymentId,

      ...existing.data(),

    };

  }


  const now =
    FieldValue.serverTimestamp();


  await paymentRef.set({

    paymentId,

    orderId,

    buyerId,

    sellerId:

      sellerId ||
      null,

    amount:
      numericAmount,

    currency:
      "KES",

    paymentMethod:
      paymentMethod
        .toUpperCase(),

    provider:
      "MPESA",

    phoneNumber:
      phoneNumber ||
      null,

    status:
      PAYMENT_STATUS.PENDING,

    orderPaymentStatus:
      ORDER_PAYMENT_STATUS.PENDING,

    providerTransactionId:
      null,

    checkoutRequestId:
      null,

    merchantRequestId:
      null,

    resultCode:
      null,

    resultDescription:
      null,

    createdAt:
      now,

    updatedAt:
      now,

  });


  return {

    created: true,

    paymentId,

  };

}


/*
=========================================================
GET PAYMENT
=========================================================
*/

async function getPayment(
  paymentId
) {

  if (!paymentId) {

    throw new Error(
      "Payment ID is required."
    );

  }


  const snap =
    await db
      .collection(
        COLLECTIONS.PAYMENTS
      )
      .doc(paymentId)
      .get();


  if (!snap.exists) {

    return null;

  }


  return {

    paymentId:
      snap.id,

    ...snap.data(),

  };

}


/*
=========================================================
GET PAYMENT BY CHECKOUT REQUEST ID
=========================================================
*/

async function getPaymentByCheckoutRequestId(
  checkoutRequestId
) {

  if (!checkoutRequestId) {

    throw new Error(
      "CheckoutRequestID is required."
    );

  }


  const snapshot =
    await db
      .collection(
        COLLECTIONS.PAYMENTS
      )
      .where(
        "checkoutRequestId",
        "==",
        checkoutRequestId
      )
      .limit(1)
      .get();


  if (snapshot.empty) {

    return null;

  }


  const doc =
    snapshot.docs[0];


  return {

    paymentId:
      doc.id,

    ...doc.data(),

  };

}


/*
=========================================================
ATTACH MPESA REQUEST
=========================================================

Called after Daraja successfully creates
an STK Push.
=========================================================
*/

async function attachMpesaRequest({

  paymentId,

  checkoutRequestId,

  merchantRequestId,

}) {

  const paymentRef =
    db
      .collection(
        COLLECTIONS.PAYMENTS
      )
      .doc(paymentId);


  await paymentRef.update({

    checkoutRequestId,

    merchantRequestId:
      merchantRequestId ||
      null,

    status:
      PAYMENT_STATUS.PENDING,

    updatedAt:
      FieldValue.serverTimestamp(),

  });


  return getPayment(
    paymentId
  );

}


/*
=========================================================
VALIDATE PAYMENT AMOUNT
=========================================================
*/

function validatePaymentAmount({

  expectedAmount,

  receivedAmount,

}) {

  const expected =
    Number(expectedAmount);

  const received =
    Number(receivedAmount);


  if (
    !Number.isFinite(expected) ||
    !Number.isFinite(received)
  ) {

    throw new Error(
      "Invalid payment amount."
    );

  }


  if (
    Math.abs(
      expected -
      received
    ) > 0.01
  ) {

    throw new Error(
      `Payment amount mismatch. Expected KES ${expected}, received KES ${received}.`
    );

  }


  return true;

}


/*
=========================================================
MARK PAYMENT SUCCESSFUL
=========================================================

This does NOT release seller money.

It only confirms that the buyer's payment
has been successfully received.

Seller funds remain HELD until settlement/
order completion.
=========================================================
*/

async function markPaymentSuccessful({

  paymentId,

  providerTransactionId,

  amount,

  resultCode = 0,

  resultDescription = "",

  providerResponse = null,

}) {

  const paymentRef =
    db
      .collection(
        COLLECTIONS.PAYMENTS
      )
      .doc(paymentId);


  const paymentSnap =
    await paymentRef.get();


  if (!paymentSnap.exists) {

    throw new Error(
      "Payment not found."
    );

  }


  const payment =
    paymentSnap.data();


  /*
  -------------------------------------------------------
  DUPLICATE CALLBACK PROTECTION
  -------------------------------------------------------
  */

  if (
    payment.status ===
    PAYMENT_STATUS.COMPLETED
  ) {

    return {

      alreadyProcessed: true,

      paymentId,

    };

  }


  /*
  -------------------------------------------------------
  AMOUNT VALIDATION
  -------------------------------------------------------
  */

  validatePaymentAmount({

    expectedAmount:
      payment.amount,

    receivedAmount:
      amount,

  });


  const now =
    FieldValue.serverTimestamp();


  await paymentRef.update({

    status:
      PAYMENT_STATUS.COMPLETED,

    orderPaymentStatus:
      ORDER_PAYMENT_STATUS.PAID,

    providerTransactionId,

    resultCode,

    resultDescription,

    providerResponse:
      providerResponse ||
      null,

    completedAt:
      now,

    updatedAt:
      now,

  });


  /*
  -------------------------------------------------------
  UPDATE ORDER
  -------------------------------------------------------
  */

  if (payment.orderId) {

    const orderRef =
      db
        .collection(
          COLLECTIONS.ORDERS
        )
        .doc(
          payment.orderId
        );


    await orderRef.update({

      paymentStatus:
        ORDER_PAYMENT_STATUS.PAID,

      paymentId:

        payment.paymentId,

      paymentCompletedAt:
        now,

      providerTransactionId,

      updatedAt:
        now,

    });

  }


  return {

    success: true,

    alreadyProcessed: false,

    paymentId,

    orderId:
      payment.orderId,

    amount:
      payment.amount,

    providerTransactionId,

    status:
      PAYMENT_STATUS.COMPLETED,

  };

}


/*
=========================================================
MARK PAYMENT FAILED
=========================================================
*/

async function markPaymentFailed({

  paymentId,

  resultCode,

  resultDescription,

  providerResponse = null,

}) {

  const paymentRef =
    db
      .collection(
        COLLECTIONS.PAYMENTS
      )
      .doc(paymentId);


  const paymentSnap =
    await paymentRef.get();


  if (!paymentSnap.exists) {

    throw new Error(
      "Payment not found."
    );

  }


  const payment =
    paymentSnap.data();


  /*
  -------------------------------------------------------
  DO NOT CHANGE A COMPLETED PAYMENT TO FAILED
  -------------------------------------------------------
  */

  if (
    payment.status ===
    PAYMENT_STATUS.COMPLETED
  ) {

    return {

      alreadyCompleted: true,

      paymentId,

    };

  }


  const now =
    FieldValue.serverTimestamp();


  await paymentRef.update({

    status:
      PAYMENT_STATUS.FAILED,

    orderPaymentStatus:
      ORDER_PAYMENT_STATUS.FAILED,

    resultCode,

    resultDescription,

    providerResponse:
      providerResponse ||
      null,

    failedAt:
      now,

    updatedAt:
      now,

  });


  /*
  -------------------------------------------------------
  UPDATE ORDER
  -------------------------------------------------------
  */

  if (payment.orderId) {

    await db
      .collection(
        COLLECTIONS.ORDERS
      )
      .doc(
        payment.orderId
      )
      .update({

        paymentStatus:
          ORDER_PAYMENT_STATUS.FAILED,

        updatedAt:
          now,

      });

  }


  return {

    success: true,

    paymentId,

    orderId:
      payment.orderId,

    status:
      PAYMENT_STATUS.FAILED,

  };

}


/*
=========================================================
CALCULATE PAYMENT FINANCIAL BREAKDOWN
=========================================================

Uses the category stored on the order.

This gives us:

saleAmount
commissionRate
commissionAmount
sellerGross
=========================================================
*/

async function calculatePaymentBreakdown({

  amount,

  category,

}) {

  return calculateCommission({

    amount,

    category,

  });

}


/*
=========================================================
EXPORT
=========================================================
*/

module.exports = {

  createPayment,

  getPayment,

  getPaymentByCheckoutRequestId,

  attachMpesaRequest,

  validatePaymentAmount,

  markPaymentSuccessful,

  markPaymentFailed,

  calculatePaymentBreakdown,

};