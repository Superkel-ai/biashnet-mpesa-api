const {
  db
} = require("../config/firebase");

const {
  stkPush
} = require("./darajaService");

const {
  money
} = require("../utils/money");

const {
  COLLECTIONS
} = require("../config/collections");

const {
  PAYMENT_STATUS,
  ORDER_STATUS,
  PAYMENT_METHODS,
  PAYMENT_PROVIDERS
} = require("../config/paymentConstants");


/*
=========================================================
PAYMENT INITIATION SERVICE
=========================================================

RESPONSIBILITY:

Start a customer payment.

FLOW:

Controller
    ↓
paymentInitiationService
    ↓
Read marketplaceOrders
    ↓
Verify buyer
    ↓
Verify order is payable
    ↓
Get authoritative amount
    ↓
Normalize phone
    ↓
Check existing active payment
    ↓
Call Daraja STK Push
    ↓
Save M-PESA IDs
    ↓
Update order
    ↓
Return payment information

IMPORTANT:

This service DOES NOT:

- credit seller wallet
- release seller funds
- complete order
- reduce stock
- create settlement
- process withdrawal
- process refund

Those belong to later services.
=========================================================
*/


/* =====================================================
   NORMALIZE PHONE
===================================================== */

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
  +254712345678
  →
  254712345678
  */

  if (value.startsWith("+254")) {

    value =
      value.substring(1);

  }


  /*
  0712345678
  →
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


  return value;
}


/* =====================================================
   VALIDATE PHONE
===================================================== */

function validatePhone(phone) {

  if (!/^2547\d{8}$/.test(phone)) {

    throw new Error(
      "Invalid Kenyan M-PESA phone number. Use 07XXXXXXXX or 2547XXXXXXXX."
    );

  }

}


/* =====================================================
   GENERATE PAYMENT ID
===================================================== */

function generatePaymentId() {

  return (
    `PAY-${Date.now()}-` +
    Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()
  );

}


/* =====================================================
   INITIATE MARKETPLACE PAYMENT
===================================================== */

async function initiateMarketplacePayment({

  orderId,

  buyerId,

  phoneNumber,

  paymentMethod = PAYMENT_METHODS.MPESA,

}) {

  console.log(
    "=========================================="
  );

  console.log(
    "🟡 PAYMENT INITIATION START"
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
    "=========================================="
  );


  /* ===================================================
     1. BASIC VALIDATION
  =================================================== */

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
    String(
      paymentMethod ||
      PAYMENT_METHODS.MPESA
    )
      .trim()
      .toUpperCase();


  if (
    normalizedMethod !==
    PAYMENT_METHODS.MPESA
  ) {

    throw new Error(
      "Currently only M-PESA payments are supported."
    );

  }


  /* ===================================================
     2. GET ORDER
  =================================================== */

  const orderRef =
    db
      .collection(
        COLLECTIONS.MARKETPLACE_ORDERS
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


  /* ===================================================
     3. VERIFY BUYER
  =================================================== */

  if (
    order.buyerId !== buyerId
  ) {

    throw new Error(
      "You are not authorized to pay for this order."
    );

  }


  /* ===================================================
     4. VERIFY PAYMENT STATUS
  =================================================== */

  if (
    order.paymentStatus ===
    PAYMENT_STATUS.COMPLETED
  ) {

    throw new Error(
      "This order has already been paid."
    );

  }


  /* ===================================================
     5. VERIFY ORDER STATUS
  =================================================== */

  const payableStatuses = [

    ORDER_STATUS.PENDING_PAYMENT,

    ORDER_STATUS.PAYMENT_INITIATED,

  ];


  if (
    !payableStatuses.includes(
      order.status
    )
  ) {

    throw new Error(
      `This order cannot be paid. Current status: ${order.status}.`
    );

  }


  /* ===================================================
     6. GET AUTHORITATIVE PAYMENT AMOUNT
  ===================================================

  NEVER accept amount from frontend.

  The amount comes from:

  marketplaceOrders.buyerTotal

  That amount was calculated when the order
  was created.
  =================================================== */

  const amount =
    money(
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


  /* ===================================================
     7. GET + NORMALIZE PHONE
  =================================================== */

  const phone =
    normalizePhone(
      phoneNumber ||
      order.buyerPhone
    );


  validatePhone(phone);


  /* ===================================================
     8. GET PAYMENT ID
  =================================================== */

  const paymentId =
    order.paymentId ||
    generatePaymentId();


  const paymentRef =
    db
      .collection(
        COLLECTIONS.MARKETPLACE_PAYMENTS
      )
      .doc(paymentId);


  /* ===================================================
     9. CHECK EXISTING PAYMENT
  =================================================== */

  const existingPaymentSnap =
    await paymentRef.get();


  if (
    existingPaymentSnap.exists
  ) {

    const existingPayment =
      existingPaymentSnap.data();


    const existingCheckoutRequestID =
      existingPayment.checkoutRequestID ||
      existingPayment.checkoutRequestId ||
      null;


    const existingMerchantRequestID =
      existingPayment.merchantRequestID ||
      existingPayment.merchantRequestId ||
      null;


    /*
    ---------------------------------------------------
    REAL ACTIVE PAYMENT EXISTS
    ---------------------------------------------------

    We DO NOT send another STK.

    This prevents:

    User taps Pay
        ↓
    STK sent

    User taps Pay again
        ↓
    second STK

    Instead we return the existing payment.
    ---------------------------------------------------
    */

    if (
      existingPayment.status ===
      PAYMENT_STATUS.PENDING &&
      existingCheckoutRequestID
    ) {

      console.log(
        "🟢 Existing active M-PESA payment found:",
        existingCheckoutRequestID
      );


      return {

        success: true,

        alreadyInitiated: true,

        paymentId,

        orderId,

        amount,

        currency: "KES",

        phone,

        paymentMethod:
          PAYMENT_METHODS.MPESA,

        provider:
          PAYMENT_PROVIDERS.MPESA,

        status:
          PAYMENT_STATUS.PENDING,

        checkoutRequestID:
          existingCheckoutRequestID,

        merchantRequestID:
          existingMerchantRequestID,

        message:
          "An M-PESA payment request is already active. Check your phone.",

      };

    }


    /*
    ---------------------------------------------------
    STALE PAYMENT
    ---------------------------------------------------

    Example:

    status = PENDING

    BUT:

    checkoutRequestID = null

    This is not an active STK.

    Therefore a new STK is allowed.
    ---------------------------------------------------
    */

    console.log(
      "⚠️ Existing payment is stale. New STK will be created."
    );

  }


  /* ===================================================
     10. CREATE ACCOUNT REFERENCE
  =================================================== */

  const accountReference =
    `ORDER-${orderId.slice(0, 8)}`;


  /* ===================================================
     11. CALL DARAJA / M-PESA
  =================================================== */

  let mpesaResponse;


  try {

    console.log(
      "📲 Sending M-PESA STK Push..."
    );


    mpesaResponse =
      await stkPush(
        phone,
        amount,
        accountReference
      );


    console.log(
      "✅ DARAJA RESPONSE:",
      JSON.stringify(
        mpesaResponse,
        null,
        2
      )
    );

  } catch (error) {

    console.error(
      "❌ M-PESA STK ERROR:",
      error.response?.data ||
      error.message ||
      error
    );


    throw new Error(
      error.response?.data?.errorMessage ||
      error.response?.data?.errorCode ||
      error.message ||
      "Failed to initiate M-PESA payment."
    );

  }


  /* ===================================================
     12. VERIFY DARAJA RESPONSE
  =================================================== */

  if (
    String(
      mpesaResponse?.ResponseCode
    ) !== "0"
  ) {

    throw new Error(
      mpesaResponse?.ResponseDescription ||
      "M-PESA STK Push was rejected."
    );

  }


  /* ===================================================
     13. EXTRACT MPESA IDENTIFIERS
  =================================================== */

  const checkoutRequestID =
    mpesaResponse.CheckoutRequestID;


  const merchantRequestID =
    mpesaResponse.MerchantRequestID;


  if (!checkoutRequestID) {

    throw new Error(
      "M-PESA did not return a CheckoutRequestID."
    );

  }


  /* ===================================================
     14. SAVE PAYMENT
  =================================================== */

  const now =
    new Date();


  await paymentRef.set({

    paymentId,

    orderId,

    buyerId,

    sellerId:
      order.sellerId,

    listingId:
      order.listingId,


    /*
    MONEY
    */

    amount,

    currency:
      "KES",


    /*
    PAYMENT
    */

    method:
      PAYMENT_METHODS.MPESA,

    provider:
      PAYMENT_PROVIDERS.MPESA,

    phone,


    /*
    STATUS
    */

    status:
      PAYMENT_STATUS.PENDING,


    /*
    DARAJA IDENTIFIERS
    */

    checkoutRequestID,

    merchantRequestID,


    /*
    PROVIDER RESPONSE
    */

    providerResponse:
      mpesaResponse,


    /*
    TIMESTAMPS
    */

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

  }, {

    merge: true

  });


  /* ===================================================
     15. UPDATE ORDER
  =================================================== */

  await orderRef.update({

    paymentId,

    paymentMethod:
      PAYMENT_METHODS.MPESA,

    buyerPhone:
      phone,

    status:
      ORDER_STATUS.PAYMENT_INITIATED,

    paymentStatus:
      PAYMENT_STATUS.PENDING,

    checkoutRequestID,

    merchantRequestID,

    paymentInitiatedAt:
      now,

    updatedAt:
      now,

  });


  /* ===================================================
     16. RETURN RESULT
  =================================================== */

  console.log(
    "✅ PAYMENT INITIATED:",
    paymentId
  );


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
      PAYMENT_METHODS.MPESA,

    provider:
      PAYMENT_PROVIDERS.MPESA,

    status:
      PAYMENT_STATUS.PENDING,

    checkoutRequestID,

    merchantRequestID,

    message:
      mpesaResponse.CustomerMessage ||
      "M-PESA payment request sent. Check your phone and enter your M-PESA PIN.",

  };

}


/* =====================================================
   EXPORT
===================================================== */

module.exports = {

  initiateMarketplacePayment,

};