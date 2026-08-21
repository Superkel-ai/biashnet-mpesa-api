const {
  db,
  FieldValue,
} = require("../config/firebase");

const {
  COLLECTIONS,
} = require("../config/collections");

const {
  PAYMENT_STATUS,
  ORDER_STATUS,
  SELLER_PAYMENT_STATUS,
  PAYOUT_STATUS,
} = require("../config/paymentConstants");

const {
  calculateCommission,
} = require("./commissionService");


/*
=========================================================
BIASHNET PAYMENT SERVICE
=========================================================

CENTRAL MARKETPLACE PAYMENT LOGIC

Handles:

- Payment creation
- Payment retrieval
- M-PESA request attachment
- Amount validation
- Payment success
- Payment failure
- Marketplace payment processing
- Order payment update
- Stock deduction
- Seller funds holding
- Duplicate callback protection

Does NOT:

- Call Safaricom
- Send STK Push
- Handle HTTP requests

Those belong to:

darajaService
paymentInitiationService
paymentCallbackService
paymentController
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
  amount,
  phoneNumber,
  paymentMethod = "MPESA",
}) {

  if (!paymentId)
    throw new Error("Payment ID is required.");

  if (!orderId)
    throw new Error("Order ID is required.");

  if (!buyerId)
    throw new Error("Buyer ID is required.");

  const numericAmount = Number(amount);

  if (
    !Number.isFinite(numericAmount) ||
    numericAmount <= 0
  ) {
    throw new Error("Invalid payment amount.");
  }

  const paymentRef = db
    .collection(COLLECTIONS.PAYMENTS)
    .doc(paymentId);

  const existing = await paymentRef.get();

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

    amount:
      numericAmount,

    currency:
      "KES",

    paymentMethod:
      String(paymentMethod)
        .toUpperCase(),

    provider:
      "MPESA",

    phoneNumber:
      phoneNumber || null,

    status:
      PAYMENT_STATUS.PENDING,

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

async function getPayment(paymentId) {

  if (!paymentId)
    throw new Error("Payment ID is required.");

  const snap = await db
    .collection(COLLECTIONS.PAYMENTS)
    .doc(paymentId)
    .get();

  if (!snap.exists)
    return null;

  return {
    paymentId: snap.id,
    ...snap.data(),
  };
}


/*
=========================================================
GET PAYMENT BY CHECKOUT REQUEST
=========================================================
*/

async function getPaymentByCheckoutRequestId(
  checkoutRequestId
) {

  if (!checkoutRequestId)
    throw new Error(
      "CheckoutRequestID is required."
    );

  let snapshot = await db
    .collection(COLLECTIONS.PAYMENTS)
    .where(
      "checkoutRequestId",
      "==",
      checkoutRequestId
    )
    .limit(1)
    .get();

  /*
  -------------------------------------------------------
  BACKWARD COMPATIBILITY
  -------------------------------------------------------
  */

  if (snapshot.empty) {

    snapshot = await db
      .collection(COLLECTIONS.PAYMENTS)
      .where(
        "checkoutRequestID",
        "==",
        checkoutRequestId
      )
      .limit(1)
      .get();

  }

  if (snapshot.empty)
    return null;

  const doc = snapshot.docs[0];

  return {
    paymentId: doc.id,
    ...doc.data(),
  };
}


/*
=========================================================
ATTACH M-PESA REQUEST
=========================================================
*/

async function attachMpesaRequest({
  paymentId,
  checkoutRequestId,
  merchantRequestId,
}) {

  if (!paymentId)
    throw new Error("Payment ID is required.");

  if (!checkoutRequestId)
    throw new Error(
      "CheckoutRequestID is required."
    );

  const paymentRef = db
    .collection(COLLECTIONS.PAYMENTS)
    .doc(paymentId);

  await paymentRef.update({

    checkoutRequestId,

    merchantRequestId:
      merchantRequestId || null,

    status:
      PAYMENT_STATUS.PENDING,

    updatedAt:
      FieldValue.serverTimestamp(),

  });

  return getPayment(paymentId);
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
    Math.abs(expected - received) > 0.01
  ) {
    throw new Error(
      `Payment amount mismatch. ` +
      `Expected KES ${expected}, ` +
      `received KES ${received}.`
    );
  }

  return true;
}


/*
=========================================================
PROCESS MARKETPLACE PAYMENT
=========================================================

THIS IS THE MAIN CALLBACK PROCESSOR.

Called after Safaricom confirms:

ResultCode === 0

It atomically:

1. Reads payment
2. Reads order
3. Reads products
4. Validates payment
5. Deducts stock
6. Completes payment
7. Marks order PAID
8. Holds seller funds
9. Prevents duplicate processing

=========================================================
*/

async function processMarketplacePayment({

  orderId,

  providerTransactionId,

  amount,

  paymentMethod = "MPESA",

  providerResponse = null,

}) {

  if (!orderId)
    throw new Error("Order ID is required.");

  if (!providerTransactionId)
    throw new Error(
      "M-PESA receipt number is required."
    );

  const orderRef = db
    .collection(COLLECTIONS.ORDERS)
    .doc(orderId);

  let processedResult;

  await db.runTransaction(
    async transaction => {

      /*
      ===================================================
      READ PAYMENT THROUGH ORDER
      ===================================================
      */

      const orderSnap =
        await transaction.get(orderRef);

      if (!orderSnap.exists)
        throw new Error(
          "Marketplace order not found."
        );

      const order =
        orderSnap.data();

      if (!order.paymentId)
        throw new Error(
          "Order has no payment record."
        );

      const paymentRef = db
        .collection(COLLECTIONS.PAYMENTS)
        .doc(order.paymentId);

      const paymentSnap =
        await transaction.get(paymentRef);

      if (!paymentSnap.exists)
        throw new Error(
          "Marketplace payment not found."
        );

      const payment =
        paymentSnap.data();


      /*
      ===================================================
      DUPLICATE PROTECTION
      ===================================================
      */

      if (
        payment.status ===
        PAYMENT_STATUS.COMPLETED
      ) {

        processedResult = {
          alreadyProcessed: true,
          paymentId: payment.paymentId,
          orderId,
          amount: payment.amount,
          providerTransactionId:
            payment.providerTransactionId,
        };

        return;

      }


      /*
      ===================================================
      BUYER / ORDER VALIDATION
      ===================================================
      */

      if (
        payment.orderId !== orderId
      ) {
        throw new Error(
          "Payment does not belong to this order."
        );
      }

      if (
        payment.buyerId !== order.buyerId
      ) {
        throw new Error(
          "Payment buyer does not match order buyer."
        );
      }


      /*
      ===================================================
      AMOUNT VALIDATION
      ===================================================
      */

      validatePaymentAmount({

        expectedAmount:
          payment.amount,

        receivedAmount:
          amount,

      });


      /*
      ===================================================
      PAYMENT METHOD
      ===================================================
      */

      if (
        String(paymentMethod)
          .toUpperCase() !== "MPESA"
      ) {
        throw new Error(
          "Unsupported payment method."
        );
      }


      /*
      ===================================================
      STOCK READS
      ===================================================

      ALL PRODUCT READS HAPPEN BEFORE WRITES.
      ===================================================
      */

      const productReads = [];

      for (
        const item of order.items || []
      ) {

        const productRef = db
          .collection(COLLECTIONS.PRODUCTS)
          .doc(item.listingId);

        const productSnap =
          await transaction.get(productRef);

        if (!productSnap.exists) {
          throw new Error(
            `Product ${item.listingId} no longer exists.`
          );
        }

        productReads.push({
          ref: productRef,
          snap: productSnap,
          item,
        });

      }


      /*
      ===================================================
      STOCK VALIDATION
      ===================================================
      */

      for (
        const product of productReads
      ) {

        const data =
          product.snap.data();

        const stock =
          Number(data.stock);

        const quantity =
          Number(product.item.quantity);

        if (
          !Number.isInteger(stock) ||
          stock < 0
        ) {
          throw new Error(
            `Invalid stock for ${product.item.listingId}.`
          );
        }

        if (
          stock < quantity
        ) {
          throw new Error(
            `Insufficient stock for ${product.item.title}.`
          );
        }

      }


      /*
      ===================================================
      STOCK DEDUCTION
      ===================================================
      */

      for (
        const product of productReads
      ) {

        const data =
          product.snap.data();

        const quantity =
          Number(product.item.quantity);

        transaction.update(
          product.ref,
          {

            stock:
              Number(data.stock) -
              quantity,

            updatedAt:
              FieldValue.serverTimestamp(),

          }
        );

      }


      /*
      ===================================================
      HOLD SELLER FUNDS
      ===================================================
      */

      const sellerBreakdown =
        (order.sellerBreakdown || [])
          .map(seller => ({

            ...seller,

            sellerPaymentStatus:
              SELLER_PAYMENT_STATUS.HELD,

            payoutStatus:
              PAYOUT_STATUS.NOT_RELEASED,

          }));


      /*
      ===================================================
      COMPLETE PAYMENT
      ===================================================
      */

      const now =
        FieldValue.serverTimestamp();

      transaction.update(
        paymentRef,
        {

          status:
            PAYMENT_STATUS.COMPLETED,

          providerTransactionId,

          resultCode:
            0,

          resultDescription:
            "Payment completed.",

          providerResponse,

          completedAt:
            now,

          updatedAt:
            now,

        }
      );


      /*
      ===================================================
      UPDATE ORDER
      ===================================================
      */

      transaction.update(
        orderRef,
        {

          paymentStatus:
            PAYMENT_STATUS.COMPLETED,

          status:
            ORDER_STATUS.PAID,

          paymentId:
            payment.paymentId,

          providerTransactionId,

          fundsReceived:
            true,

          fundsHeld:
            true,

          sellerPaymentStatus:
            SELLER_PAYMENT_STATUS.HELD,

          payoutStatus:
            PAYOUT_STATUS.NOT_RELEASED,

          sellerBreakdown,

          stockStatus:
            "DEDUCTED",

          paymentCompletedAt:
            now,

          updatedAt:
            now,

        }
      );


      processedResult = {

        success: true,

        alreadyProcessed: false,

        paymentId:
          payment.paymentId,

        orderId,

        amount:
          payment.amount,

        providerTransactionId,

        status:
          PAYMENT_STATUS.COMPLETED,

      };

    }
  );

  return processedResult;
}


/*
=========================================================
MARK PAYMENT SUCCESSFUL
=========================================================

Compatibility wrapper.

Marketplace callbacks should use:

processMarketplacePayment()

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

  const payment =
    await getPayment(paymentId);

  if (!payment)
    throw new Error(
      "Payment not found."
    );

  return processMarketplacePayment({

    orderId:
      payment.orderId,

    providerTransactionId,

    amount,

    paymentMethod:
      payment.paymentMethod,

    providerResponse: {
      ...providerResponse,
      ResultCode:
        resultCode,
      ResultDesc:
        resultDescription,
    },

  });
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

  if (!paymentId)
    throw new Error(
      "Payment ID is required."
    );

  const paymentRef = db
    .collection(COLLECTIONS.PAYMENTS)
    .doc(paymentId);

  const paymentSnap =
    await paymentRef.get();

  if (!paymentSnap.exists)
    throw new Error(
      "Payment not found."
    );

  const payment =
    paymentSnap.data();

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

    resultCode,

    resultDescription,

    providerResponse,

    failedAt:
      now,

    updatedAt:
      now,

  });


  /*
  -------------------------------------------------------
  ORDER
  -------------------------------------------------------
  */

  if (payment.orderId) {

    const orderRef = db
      .collection(COLLECTIONS.ORDERS)
      .doc(payment.orderId);

    const orderSnap =
      await orderRef.get();

    if (orderSnap.exists) {

      const order =
        orderSnap.data();

      if (
        order.paymentStatus !==
        PAYMENT_STATUS.COMPLETED
      ) {

        await orderRef.update({

          paymentStatus:
            PAYMENT_STATUS.FAILED,

          status:
            ORDER_STATUS.PENDING_PAYMENT,

          updatedAt:
            now,

        });

      }

    }

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
CALCULATE PAYMENT BREAKDOWN
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
EXPORTS
=========================================================
*/

module.exports = {

  createPayment,

  getPayment,

  getPaymentByCheckoutRequestId,

  attachMpesaRequest,

  validatePaymentAmount,

  processMarketplacePayment,

  markPaymentSuccessful,

  markPaymentFailed,

  calculatePaymentBreakdown,

};