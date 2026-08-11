const {
  db
} = require("../config/firebase");

const {
  stkPush
} = require("./mpesa");


/*
=========================================================
MARKETPLACE PAYMENT SERVICE
=========================================================

Uses:

services/mpesa.js

NOT IntaSend.

Collections:

marketplaceOrders
marketplacePayments
marketplaceTransactions

Products:

products/{listingId}

IMPORTANT:

- buyerId comes from Firebase Auth
- amount comes from marketplaceOrders
- frontend amount is never trusted
- sellerId comes from the order
- stock is reduced ONLY after successful payment
=========================================================
*/


/*
=========================================================
HELPERS
=========================================================
*/

function normalizePhone(phone) {

  if (!phone) {
    return "";
  }

  let value =
    String(phone)
      .trim()
      .replace(/\s+/g, "")
      .replace(/-/g, "");


  /*
  0712345678
  ->
  254712345678
  */

  if (
    value.startsWith("0") &&
    value.length === 10
  ) {

    value =
      "254" +
      value.substring(1);

  }


  /*
  +254712345678
  ->
  254712345678
  */

  if (
    value.startsWith("+254")
  ) {

    value =
      value.substring(1);

  }


  return value;

}


function normalizePaymentMethod(method) {

  const value =
    String(method || "MPESA")
      .trim()
      .toUpperCase()
      .replace("-", "");


  return value === "MPESA"
    ? "MPESA"
    : value;

}


function generatePaymentId() {

  return (
    `PAY-${Date.now()}-` +
    Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()
  );

}


function generateTransactionId() {

  return (
    `SALE-${Date.now()}-` +
    Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()
  );

}


/*
=========================================================
INITIATE MARKETPLACE PAYMENT
=========================================================

Flow:

1. Get order
2. Verify buyer
3. Verify order status
4. Get authoritative amount
5. Normalize phone
6. Check for REAL active STK
7. Call your existing stkPush()
8. Save CheckoutRequestID
9. Update order
10. Return result
=========================================================
*/

async function initiateMarketplacePayment({

  orderId,

  buyerId,

  phoneNumber,

  paymentMethod = "MPESA",

}) {

  console.log(
    "=========================================="
  );

  console.log(
    "🟡 MARKETPLACE PAYMENT START"
  );

  console.log(
    "Order:",
    orderId
  );

  console.log(
    "Buyer:",
    buyerId
  );

  console.log(
    "Phone:",
    phoneNumber
  );

  console.log(
    "=========================================="
  );


  /*
  =======================================================
  VALIDATION
  =======================================================
  */

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


  const normalizedMethod =
    normalizePaymentMethod(
      paymentMethod
    );


  if (
    normalizedMethod !== "MPESA"
  ) {

    throw new Error(
      "Currently only M-PESA payments are supported."
    );

  }


  /*
  =======================================================
  GET ORDER
  =======================================================
  */

  const orderRef =
    db
      .collection(
        "marketplaceOrders"
      )
      .doc(orderId);


  const orderSnap =
    await orderRef.get();


  if (!orderSnap.exists) {

    throw new Error(
      "Marketplace order not found."
    );

  }


  const order =
    orderSnap.data();


  console.log(
    "📦 Marketplace order:",
    JSON.stringify(
      order,
      null,
      2
    )
  );


  /*
  =======================================================
  VERIFY BUYER
  =======================================================
  */

  if (
    order.buyerId !== buyerId
  ) {

    throw new Error(
      "You are not authorized to pay for this order."
    );

  }


  /*
  =======================================================
  CHECK PAYMENT STATUS
  =======================================================
  */

  if (
    order.paymentStatus ===
    "COMPLETED"
  ) {

    throw new Error(
      "This order has already been paid."
    );

  }


  /*
  =======================================================
  ORDER STATUS
  =======================================================
  */

  if (
    order.status !==
      "PENDING_PAYMENT" &&
    order.status !==
      "PAYMENT_INITIATED"
  ) {

    throw new Error(
      `This order cannot be paid. Current status: ${order.status}.`
    );

  }


  /*
  =======================================================
  AUTHORITATIVE AMOUNT
  =======================================================
  */

  const amount =
    Number(
      order.buyerTotal
    );


  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {

    throw new Error(
      "Invalid marketplace order amount."
    );

  }


  console.log(
    "💰 Marketplace amount:",
    amount
  );


  /*
  =======================================================
  PHONE
  =======================================================
  */

  const phone =
    normalizePhone(
      phoneNumber ||
      order.buyerPhone
    );


  console.log(
    "📱 Normalized M-Pesa phone:",
    phone
  );


  if (!phone) {

    throw new Error(
      "M-PESA phone number is required."
    );

  }


  if (
    !/^2547\d{8}$/.test(phone)
  ) {

    throw new Error(
      "Invalid Kenyan M-PESA phone number. Use 07XXXXXXXX or 2547XXXXXXXX."
    );

  }


  /*
  =======================================================
  PAYMENT ID
  =======================================================
  */

  const paymentId =
    order.paymentId ||
    generatePaymentId();


  const paymentRef =
    db
      .collection(
        "marketplacePayments"
      )
      .doc(paymentId);


  /*
  =======================================================
  CHECK EXISTING PAYMENT
  =======================================================

  IMPORTANT FIX:

  DO NOT blindly trust:

      status === "PENDING"

  A previous broken/old payment may have:

      status: PENDING

  but NO CheckoutRequestID.

  Such a payment must NOT block a new STK push.
  =======================================================
  */

  const existingPaymentSnap =
    await paymentRef.get();


  if (
    existingPaymentSnap.exists
  ) {

    const existingPayment =
      existingPaymentSnap.data();


    const existingCheckoutId =
      existingPayment.checkoutRequestID ||
      existingPayment.checkoutRequestId ||
      null;


    const existingMerchantId =
      existingPayment.merchantRequestID ||
      existingPayment.merchantRequestId ||
      null;


    /*
    -------------------------------------------------------
    REAL ACTIVE STK EXISTS
    -------------------------------------------------------
    */

    if (
      existingPayment.status === "PENDING" &&
      existingCheckoutId
    ) {

      console.log(
        "🟢 Existing REAL M-PESA STK found:",
        existingCheckoutId
      );


      return {

        success: true,

        alreadyInitiated: true,

        paymentId,

        orderId,

        amount,

        currency: "KES",

        phone,

        paymentMethod: "MPESA",

        status: "PENDING",

        checkoutRequestID:
          existingCheckoutId,

        merchantRequestID:
          existingMerchantId,

        message:
          "An M-PESA payment request is already active. Check your phone.",

      };

    }


    /*
    -------------------------------------------------------
    STALE / BROKEN PAYMENT
    -------------------------------------------------------

    Example:

    status = PENDING
    checkoutRequestID = null

    This must NOT block a new STK.
    -------------------------------------------------------
    */

    console.log(
      "⚠️ Existing payment is stale or incomplete. Creating a new M-PESA STK."
    );

  }


  /*
  =======================================================
  CALL YOUR REAL M-PESA STK SERVICE
  =======================================================
  */

  let mpesaResponse;


  try {

    console.log(
      "📲 Calling Safaricom M-PESA STK..."
    );


    mpesaResponse =
      await stkPush(
        phone,
        amount,
        `ORDER-${orderId.slice(0, 8)}`
      );


    console.log(
      "✅ M-PESA RESPONSE:",
      JSON.stringify(
        mpesaResponse,
        null,
        2
      )
    );

  } catch (error) {

    console.error(
      "❌ M-PESA STK PUSH ERROR:",
      error.response?.data ||
      error.message ||
      error
    );


    throw new Error(
      error.response?.data?.errorMessage ||
      error.response?.data?.errorCode ||
      error.message ||
      "Failed to initiate M-PESA STK Push."
    );

  }


  /*
  =======================================================
  VERIFY SAFARICOM RESPONSE
  =======================================================
  */

  if (
    String(
      mpesaResponse?.ResponseCode
    ) !== "0"
  ) {

    console.error(
      "❌ Safaricom rejected STK:",
      mpesaResponse
    );


    throw new Error(
      mpesaResponse?.ResponseDescription ||
      "M-PESA STK Push was rejected."
    );

  }


  /*
  =======================================================
  EXTRACT MPESA IDs
  =======================================================
  */

  const checkoutRequestID =
    mpesaResponse.CheckoutRequestID;


  const merchantRequestID =
    mpesaResponse.MerchantRequestID;


  if (!checkoutRequestID) {

    throw new Error(
      "M-PESA did not return a CheckoutRequestID."
    );

  }


  console.log(
    "🟢 CheckoutRequestID:",
    checkoutRequestID
  );


  console.log(
    "🟢 MerchantRequestID:",
    merchantRequestID
  );


  /*
  =======================================================
  SAVE PAYMENT
  =======================================================
  */

  const now =
    new Date();


  await paymentRef.set(
    {

      paymentId,

      orderId,

      buyerId,

      sellerId:
        order.sellerId,

      listingId:
        order.listingId,

      amount,

      currency:
        "KES",

      method:
        "MPESA",

      provider:
        "MPESA",

      phone,

      status:
        "PENDING",

      checkoutRequestID,

      merchantRequestID,

      /*
      Keep original Safaricom response.
      */

      providerResponse:
        mpesaResponse,

      createdAt:
        existingPaymentSnap.exists
          ? (
              existingPaymentSnap
                .data()
                .createdAt ||
              now
            )
          : now,

      updatedAt:
        now,

    },

    {
      merge: true
    }

  );


  /*
  =======================================================
  UPDATE ORDER
  =======================================================
  */

  await orderRef.update({

    paymentId,

    paymentMethod:
      "MPESA",

    buyerPhone:
      phone,

    status:
      "PAYMENT_INITIATED",

    paymentStatus:
      "PENDING",

    checkoutRequestID,

    merchantRequestID,

    paymentInitiatedAt:
      now,

    updatedAt:
      now,

  });


  console.log(
    "💾 Marketplace payment saved:",
    paymentId
  );


  /*
  =======================================================
  RETURN TO FRONTEND
  =======================================================
  */

  return {

    success: true,

    alreadyInitiated: false,

    paymentId,

    orderId,

    amount,

    currency:
      "KES",

    phone,

    paymentMethod:
      "MPESA",

    provider:
      "MPESA",

    status:
      "PENDING",

    checkoutRequestID,

    merchantRequestID,

    message:
      mpesaResponse.CustomerMessage ||
      "M-PESA payment request sent. Check your phone and enter your M-PESA PIN.",

  };

}


/*
=========================================================
PROCESS SUCCESSFUL MARKETPLACE PAYMENT
=========================================================

Called from your M-PESA callback.

The callback should provide:

orderId
providerTransactionId
amount
providerResponse

Stock is reduced ONLY after successful payment.
=========================================================
*/

async function processMarketplacePayment({

  orderId,

  providerTransactionId,

  amount,

  paymentMethod = "MPESA",

  providerResponse = null,

}) {

  if (!orderId) {

    throw new Error(
      "Order ID is required."
    );

  }


  if (!providerTransactionId) {

    throw new Error(
      "M-PESA transaction ID is required."
    );

  }


  const paidAmount =
    Number(amount);


  if (
    !Number.isFinite(paidAmount) ||
    paidAmount <= 0
  ) {

    throw new Error(
      "Invalid payment amount."
    );

  }


  /*
  =======================================================
  GET ORDER
  =======================================================
  */

  const orderRef =
    db
      .collection(
        "marketplaceOrders"
      )
      .doc(orderId);


  const orderSnap =
    await orderRef.get();


  if (!orderSnap.exists) {

    throw new Error(
      "Marketplace order not found."
    );

  }


  const order =
    orderSnap.data();


  /*
  =======================================================
  VERIFY AMOUNT
  =======================================================
  */

  const expectedAmount =
    Number(
      order.buyerTotal
    );


  if (
    Math.abs(
      paidAmount -
      expectedAmount
    ) > 0.01
  ) {

    throw new Error(
      `Payment amount mismatch. Expected KES ${expectedAmount}, received KES ${paidAmount}.`
    );

  }


  /*
  =======================================================
  DUPLICATE PAYMENT CHECK
  =======================================================
  */

  const existingPaymentSnap =
    await db
      .collection(
        "marketplacePayments"
      )
      .where(
        "providerTransactionId",
        "==",
        providerTransactionId
      )
      .limit(1)
      .get();


  if (
    !existingPaymentSnap.empty
  ) {

    const existing =
      existingPaymentSnap
        .docs[0]
        .data();


    return {

      success: true,

      alreadyProcessed: true,

      orderId,

      paymentId:
        existing.paymentId,

      providerTransactionId,

    };

  }


  /*
  =======================================================
  PAYMENT ID
  =======================================================
  */

  const paymentId =
    order.paymentId ||
    generatePaymentId();


  const paymentRef =
    db
      .collection(
        "marketplacePayments"
      )
      .doc(paymentId);


  const transactionId =
    generateTransactionId();


  const transactionRef =
    db
      .collection(
        "marketplaceTransactions"
      )
      .doc(transactionId);


  const productRef =
    db
      .collection("products")
      .doc(order.listingId);


  const now =
    new Date();


  /*
  =======================================================
  ATOMIC PAYMENT SUCCESS
  =======================================================
  */

  await db.runTransaction(
    async (transaction) => {

      /*
      ---------------------------------------------------
      READ ORDER
      ---------------------------------------------------
      */

      const freshOrderSnap =
        await transaction.get(
          orderRef
        );


      if (
        !freshOrderSnap.exists
      ) {

        throw new Error(
          "Marketplace order no longer exists."
        );

      }


      const freshOrder =
        freshOrderSnap.data();


      /*
      ---------------------------------------------------
      ALREADY PAID
      ---------------------------------------------------
      */

      if (
        freshOrder.paymentStatus ===
        "COMPLETED"
      ) {

        return;

      }


      /*
      ---------------------------------------------------
      READ PRODUCT
      ---------------------------------------------------
      */

      const productSnap =
        await transaction.get(
          productRef
        );


      if (
        !productSnap.exists
      ) {

        throw new Error(
          "Product no longer exists."
        );

      }


      const product =
        productSnap.data();


      /*
      ---------------------------------------------------
      CURRENT STOCK
      ---------------------------------------------------
      */

      const quantity =
        Number(
          freshOrder.quantity || 0
        );


      const currentStock =
        Number(
          product.stock || 0
        );


      if (
        quantity <= 0
      ) {

        throw new Error(
          "Invalid order quantity."
        );

      }


      if (
        currentStock < quantity
      ) {

        throw new Error(
          "Insufficient stock to complete this payment."
        );

      }


      /*
      ---------------------------------------------------
      REDUCE STOCK
      ---------------------------------------------------
      */

      transaction.update(
        productRef,
        {

          stock:
            currentStock -
            quantity,

          updatedAt:
            now,

        }
      );


      /*
      ---------------------------------------------------
      UPDATE ORDER
      ---------------------------------------------------
      */

      transaction.update(
        orderRef,
        {

          status:
            "PAID",

          paymentStatus:
            "COMPLETED",

          paymentCompletedAt:
            now,

          providerTransactionId,

          paymentMethod:
            "MPESA",

          fundsReceived:
            true,

          fundsHeld:
            true,

          sellerPaymentStatus:
            "HELD",

          payoutStatus:
            "NOT_RELEASED",

          updatedAt:
            now,

        }
      );


      /*
      ---------------------------------------------------
      PAYMENT RECORD
      ---------------------------------------------------
      */

      transaction.set(
        paymentRef,
        {

          paymentId,

          orderId,

          buyerId:
            freshOrder.buyerId,

          sellerId:
            freshOrder.sellerId,

          listingId:
            freshOrder.listingId,

          amount:
            paidAmount,

          currency:
            "KES",

          method:
            "MPESA",

          provider:
            "MPESA",

          providerTransactionId,

          status:
            "COMPLETED",

          providerResponse:
            providerResponse ||
            null,

          completedAt:
            now,

          updatedAt:
            now,

        },

        {
          merge: true
        }

      );


      /*
      ---------------------------------------------------
      FINANCIAL LEDGER
      ---------------------------------------------------
      */

      transaction.set(
        transactionRef,
        {

          transactionId,

          type:
            "MARKETPLACE_SALE",

          orderId,

          paymentId,

          buyerId:
            freshOrder.buyerId,

          sellerId:
            freshOrder.sellerId,

          listingId:
            freshOrder.listingId,

          amount:
            paidAmount,

          currency:
            "KES",

          commissionRate:
            Number(
              freshOrder.commissionRate ||
              0
            ),

          commissionAmount:
            Number(
              freshOrder.commissionAmount ||
              0
            ),

          sellerGross:
            Number(
              freshOrder.sellerGross ||
              0
            ),

          sellerNet:
            Number(
              freshOrder.sellerNet ||
              0
            ),

          paymentMethod:
            "MPESA",

          provider:
            "MPESA",

          providerTransactionId,

          status:
            "COMPLETED",

          createdAt:
            now,

          updatedAt:
            now,

        }

      );

    }
  );


  return {

    success: true,

    alreadyProcessed: false,

    orderId,

    paymentId,

    transactionId,

    providerTransactionId,

    amount:
      paidAmount,

    commissionAmount:
      Number(
        order.commissionAmount ||
        0
      ),

    sellerAmount:
      Number(
        order.sellerNet ||
        0
      ),

    status:
      "PAID",

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
        "marketplacePayments"
      )
      .doc(paymentId)
      .get();


  if (!snap.exists) {

    return null;

  }


  return {

    id:
      snap.id,

    ...snap.data(),

  };

}


/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

  initiateMarketplacePayment,

  processMarketplacePayment,

  getPayment,

};