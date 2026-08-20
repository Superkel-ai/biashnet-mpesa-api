const { db } = require("../config/firebase");
const { stkPush } = require("./darajaService");
const { money } = require("../utils/money");
const { COLLECTIONS } = require("../config/collections");

const {
  PAYMENT_STATUS,
  ORDER_STATUS,
  PAYMENT_METHODS,
  PAYMENT_PROVIDERS,
} = require("../config/paymentConstants");

function normalizePhone(phone) {
  if (!phone) return "";

  let value = String(phone)
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "");

  if (value.startsWith("+254")) {
    value = value.substring(1);
  }

  if (
    (value.startsWith("07") || value.startsWith("01")) &&
    value.length === 10
  ) {
    value = "254" + value.substring(1);
  }

  return value;
}

function validatePhone(phone) {
  if (!/^254[71]\d{8}$/.test(phone)) {
    throw new Error(
      "Invalid Kenyan M-PESA phone number. Use 07XXXXXXXX, 01XXXXXXXX or 254XXXXXXXXX."
    );
  }
}

function generatePaymentId() {
  return `PAY-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase()}`;
}

async function initiateMarketplacePayment({
  orderId,
  buyerId,
  phoneNumber,
  paymentMethod = PAYMENT_METHODS.MPESA,
}) {
  if (!orderId) {
    throw new Error("Order ID is required.");
  }

  if (!buyerId) {
    throw new Error("Buyer ID is required.");
  }

  const method = String(paymentMethod || PAYMENT_METHODS.MPESA)
    .trim()
    .toUpperCase();

  if (method !== PAYMENT_METHODS.MPESA) {
    throw new Error("Currently only M-PESA payments are supported.");
  }

  /*
  ========================================================
  1. GET MARKETPLACE ORDER
  ========================================================
  */

  const orderRef = db
    .collection(COLLECTIONS.ORDERS)
    .doc(orderId);

  const orderSnap = await orderRef.get();

  if (!orderSnap.exists) {
    throw new Error("Marketplace order not found.");
  }

  const order = orderSnap.data();

  /*
  ========================================================
  2. VERIFY BUYER
  ========================================================
  */

  if (order.buyerId !== buyerId) {
    throw new Error(
      "You are not authorized to pay for this order."
    );
  }

  /*
  ========================================================
  3. VERIFY ORDER STATUS
  ========================================================
  */

  if (
    order.paymentStatus === PAYMENT_STATUS.COMPLETED
  ) {
    throw new Error("This order has already been paid.");
  }

  const payableStatuses = [
    ORDER_STATUS.PENDING_PAYMENT,
    ORDER_STATUS.PAYMENT_INITIATED,
  ];

  if (!payableStatuses.includes(order.status)) {
    throw new Error(
      `This order cannot be paid. Current status: ${order.status}.`
    );
  }

  /*
  ========================================================
  4. AUTHORITATIVE AMOUNT
  ========================================================

  Never accept amount from frontend.
  The checkout service already calculated buyerTotal.
  */

  const amount = money(order.buyerTotal);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid marketplace order amount.");
  }

  /*
  ========================================================
  5. PHONE
  ========================================================
  */

  const phone = normalizePhone(
    phoneNumber || order.buyerPhone
  );

  validatePhone(phone);

  /*
  ========================================================
  6. PAYMENT ID
  ========================================================
  */

  const paymentId =
    order.paymentId || generatePaymentId();

  const paymentRef = db
    .collection(COLLECTIONS.PAYMENTS)
    .doc(paymentId);

  /*
  ========================================================
  7. CHECK EXISTING PAYMENT
  ========================================================
  */

  const existingPaymentSnap =
    await paymentRef.get();

  if (existingPaymentSnap.exists) {
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

    if (
      existingPayment.status ===
        PAYMENT_STATUS.PENDING &&
      existingCheckoutRequestID
    ) {
      return {
        success: true,
        alreadyInitiated: true,
        paymentId,
        orderId,
        amount,
        currency: "KES",
        phone,
        paymentMethod: PAYMENT_METHODS.MPESA,
        provider: PAYMENT_PROVIDERS.MPESA,
        status: PAYMENT_STATUS.PENDING,
        checkoutRequestID:
          existingCheckoutRequestID,
        merchantRequestID:
          existingMerchantRequestID,
        message:
          "An M-PESA payment request is already active. Check your phone.",
      };
    }
  }

  /*
  ========================================================
  8. SEND STK PUSH
  ========================================================
  */

  const accountReference =
    `ORDER-${orderId.slice(0, 8)}`;

  let mpesaResponse;

  try {
    console.log(
      `📲 Sending STK Push: ${orderId} | KES ${amount} | ${phone}`
    );

    mpesaResponse = await stkPush(
      phone,
      amount,
      accountReference
    );

    console.log(
      "✅ Daraja response:",
      JSON.stringify(mpesaResponse)
    );

  } catch (error) {
    console.error(
      "❌ STK Push error:",
      error.response?.data || error.message
    );

    throw new Error(
      error.response?.data?.errorMessage ||
      error.response?.data?.errorCode ||
      error.message ||
      "Failed to initiate M-PESA payment."
    );
  }

  /*
  ========================================================
  9. VERIFY DARAJA RESPONSE
  ========================================================
  */

  if (
    String(mpesaResponse?.ResponseCode) !== "0"
  ) {
    throw new Error(
      mpesaResponse?.ResponseDescription ||
      "M-PESA STK Push was rejected."
    );
  }

  const checkoutRequestID =
    mpesaResponse.CheckoutRequestID;

  const merchantRequestID =
    mpesaResponse.MerchantRequestID;

  if (!checkoutRequestID) {
    throw new Error(
      "M-PESA did not return a CheckoutRequestID."
    );
  }

  /*
  ========================================================
  10. SAVE PAYMENT
  ========================================================

  IMPORTANT:

  This order can contain multiple sellers.

  Therefore we store sellerIds and items from
  marketplaceOrders instead of sellerId/listingId.
  */

  const now = new Date();

  await paymentRef.set(
    {
      paymentId,
      orderId,
      buyerId,

      sellerIds: order.sellerIds || [],

      items: order.items || [],

      amount,
      currency: "KES",

      method: PAYMENT_METHODS.MPESA,
      provider: PAYMENT_PROVIDERS.MPESA,
      phone,

      status: PAYMENT_STATUS.PENDING,

      checkoutRequestID,
      merchantRequestID,

      providerResponse: mpesaResponse,

      createdAt:
        existingPaymentSnap.exists
          ? existingPaymentSnap.data().createdAt || now
          : now,

      updatedAt: now,
    },
    { merge: true }
  );

  /*
  ========================================================
  11. UPDATE MARKETPLACE ORDER
  ========================================================
  */

  await orderRef.update({
    paymentId,

    paymentMethod:
      PAYMENT_METHODS.MPESA,

    buyerPhone: phone,

    status:
      ORDER_STATUS.PAYMENT_INITIATED,

    paymentStatus:
      PAYMENT_STATUS.PENDING,

    checkoutRequestID,
    merchantRequestID,

    paymentInitiatedAt: now,
    updatedAt: now,
  });

  /*
  ========================================================
  12. RETURN PAYMENT INFORMATION
  ========================================================
  */

  console.log(
    `✅ PAYMENT INITIATED: ${paymentId}`
  );

  return {
    success: true,
    alreadyInitiated: false,

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

    checkoutRequestID,
    merchantRequestID,

    message:
      mpesaResponse.CustomerMessage ||
      "M-PESA payment request sent. Check your phone and enter your M-PESA PIN.",
  };
}

module.exports = {
  initiateMarketplacePayment,
};