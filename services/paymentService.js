const { db } = require("../config/firebase");
const { stkPush } = require("./mpesa");

/*
=========================================================
MARKETPLACE PAYMENT SERVICE
=========================================================

Collections:

marketplaceOrders
marketplacePayments
marketplaceTransactions

Products:

products/{listingId}

IMPORTANT:

- buyerId comes from Firebase Authentication.
- sellerId comes from the order/product.
- Amount comes ONLY from marketplaceOrders.
- Frontend amount is NEVER trusted.
- STK Push uses the existing services/mpesa.js.
- Stock is reduced ONLY after successful payment callback.
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

  let value = String(phone)
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "");

  // +254712345678 -> 254712345678
  if (value.startsWith("+254")) {
    value = value.substring(1);
  }

  // 0712345678 -> 254712345678
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


function normalizePaymentMethod(method) {

  const value = String(
    method || "MPESA"
  )
    .trim()
    .toUpperCase()
    .replace("-", "");

  return value;
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

POST:

/api/marketplace/payments/initiate

This function:

1. Gets order
2. Verifies buyer
3. Gets authoritative amount
4. Normalizes phone
5. Calls YOUR existing mpesa.js
6. Saves CheckoutRequestID
7. Updates order
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
  ========================================================
  VALIDATION
  ========================================================
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
  ========================================================
  GET ORDER
  ========================================================
  */

  const orderRef =
    db
      .collection("marketplaceOrders")
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
  ========================================================
  VERIFY BUYER
  ========================================================
  */

  if (
    order.buyerId !== buyerId
  ) {

    throw new Error(
      "You are not authorized to pay for this order."
    );

  }


  /*
  ========================================================
  VERIFY ORDER STATUS
  ========================================================
  */

  if (
    order.paymentStatus ===
    "COMPLETED"
  ) {

    throw new Error(
      "This order has already been paid."
    );

  }


  if (
    order.status !==
      "PENDING_PAYMENT" &&
    order.status !==
      "PAYMENT_INITIATED"
  ) {

    throw new Error(
      `This order cannot be paid. Current status: ${order.status}`
    );

  }


  /*
  ========================================================
  AUTHORITATIVE AMOUNT
  ========================================================
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


  /*
  ========================================================
  PHONE
  ========================================================
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
      "M-Pesa phone number is required."
    );

  }


  if (
    !/^2547\d{8}$/.test(phone)
  ) {

    throw new Error(
      "Invalid Kenyan M-Pesa phone number. Use 2547XXXXXXXX."
    );

  }


  /*
  ========================================================
  PAYMENT ID
  ========================================================
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
  ========================================================
  CHECK EXISTING PAYMENT
  ========================================================
  */

  const existingPaymentSnap =
    await paymentRef.get();


  if (
    existingPaymentSnap.exists
  ) {

    const existingPayment =
      existingPaymentSnap.data();


    if (
      existingPayment.status ===
        "PENDING" ||
      existingPayment.status ===
        "PROCESSING"
    ) {

      console.log(
        "⚠️ Existing pending payment found:",
        paymentId
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

        status:
          existingPayment.status,

        checkoutRequestID:
          existingPayment.checkoutRequestID ||
          null,

        merchantRequestID:
          existingPayment.merchantRequestID ||
          null,

      };

    }

  }


  /*
  ========================================================
  M-PESA STK PUSH
  ========================================================

  THIS IS THE IMPORTANT PART.

  It uses exactly the same:

      services/mpesa.js

  used by your working investor Deposit dialog.
  ========================================================
  */

  let mpesaResponse;


  try {

    console.log(
      "📲 Sending marketplace M-Pesa STK..."
    );

    console.log(
      "Amount:",
      amount
    );

    console.log(
      "Phone:",
      phone
    );


    mpesaResponse =
      await stkPush(
        phone,
        amount,
        `ORDER-${orderId.slice(0, 8)}`
      );


  } catch (error) {

    console.error(
      "❌ MARKETPLACE STK PUSH ERROR:"
    );

    console.error(
      error.response?.data ||
      error.message ||
      error
    );


    throw new Error(
      error.response?.data?.errorMessage ||
      error.response?.data?.errorDescription ||
      error.message ||
      "Failed to initiate M-Pesa STK Push."
    );

  }


  /*
  ========================================================
  LOG SAFARICOM RESPONSE
  ========================================================
  */

  console.log(
    "✅ MARKETPLACE M-PESA RESPONSE:"
  );

  console.log(
    JSON.stringify(
      mpesaResponse,
      null,
      2
    )
  );


  /*
  ========================================================
  VERIFY SAFARICOM RESPONSE
  ========================================================
  */

  if (
    String(
      mpesaResponse?.ResponseCode
    ) !== "0"
  ) {

    console.error(
      "❌ Safaricom rejected STK request:"
    );

    console.error(
      mpesaResponse
    );


    throw new Error(
      mpesaResponse?.ResponseDescription ||
      mpesaResponse?.CustomerMessage ||
      "M-Pesa STK Push was rejected."
    );

  }


  /*
  ========================================================
  EXTRACT SAFARICOM IDS
  ========================================================
  */

  const checkoutRequestID =
    mpesaResponse
      ?.CheckoutRequestID ||
    null;


  const merchantRequestID =
    mpesaResponse
      ?.MerchantRequestID ||
    null;


  if (!checkoutRequestID) {

    throw new Error(
      "M-Pesa did not return a CheckoutRequestID."
    );

  }


  const now =
    new Date();


  /*
  ========================================================
  SAVE PAYMENT + UPDATE ORDER
  ========================================================
  */

  await db.runTransaction(
    async (transaction) => {

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


      if (
        freshOrder.buyerId !==
        buyerId
      ) {

        throw new Error(
          "Order ownership verification failed."
        );

      }


      /*
      -----------------------------------------------
      PAYMENT RECORD
      -----------------------------------------------
      */

      transaction.set(
        paymentRef,
        {

          paymentId,

          orderId,

          buyerId,

          sellerId:
            freshOrder.sellerId ||
            null,

          listingId:
            freshOrder.listingId ||
            null,

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

          providerResponse:
            mpesaResponse,

          createdAt:
            now,

          updatedAt:
            now,

        },
        {
          merge: true
        }
      );


      /*
      -----------------------------------------------
      UPDATE ORDER
      -----------------------------------------------
      */

      transaction.update(
        orderRef,
        {

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

        }
      );

    }
  );


  /*
  ========================================================
  SUCCESS
  ========================================================
  */

  console.log(
    "🟢 MARKETPLACE STK SUCCESS"
  );

  console.log(
    "CheckoutRequestID:",
    checkoutRequestID
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
      "MPESA",

    provider:
      "MPESA",

    status:
      "PENDING",

    checkoutRequestID,

    merchantRequestID,

    message:
      mpesaResponse.CustomerMessage ||
      "M-Pesa payment request sent. Check your phone and enter your M-Pesa PIN.",

  };

}


/*
=========================================================
PROCESS SUCCESSFUL MARKETPLACE PAYMENT
=========================================================

Called by your M-Pesa callback.

IMPORTANT:

Stock is reduced ONLY after Safaricom confirms
successful payment.
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
      "M-Pesa transaction ID is required."
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
  ========================================================
  GET ORDER
  ========================================================
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
  ========================================================
  VERIFY AMOUNT
  ========================================================
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
  ========================================================
  DUPLICATE PAYMENT CHECK
  ========================================================
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
  ========================================================
  PAYMENT ID
  ========================================================
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


  /*
  ========================================================
  PRODUCT
  ========================================================
  */

  const productRef =
    db
      .collection("products")
      .doc(
        order.listingId
      );


  const now =
    new Date();


  /*
  ========================================================
  ATOMIC PAYMENT SUCCESS
  ========================================================
  */

  await db.runTransaction(
    async (transaction) => {

      /*
      IMPORTANT:

      All reads happen before writes.
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
      -----------------------------------------------
      ALREADY PAID
      -----------------------------------------------
      */

      if (
        freshOrder.paymentStatus ===
        "COMPLETED"
      ) {

        return;

      }


      /*
      -----------------------------------------------
      GET PRODUCT
      -----------------------------------------------
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


      const quantity =
        Number(
          freshOrder.quantity || 1
        );


      const currentStock =
        Number(
          product.stock || 0
        );


      /*
      -----------------------------------------------
      STOCK
      -----------------------------------------------
      */

      if (
        currentStock <
        quantity
      ) {

        throw new Error(
          "Insufficient stock to complete this payment."
        );

      }


      /*
      -----------------------------------------------
      REDUCE STOCK
      -----------------------------------------------
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
      -----------------------------------------------
      UPDATE ORDER
      -----------------------------------------------
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

          updatedAt:
            now,

        }
      );


      /*
      -----------------------------------------------
      PAYMENT
      -----------------------------------------------
      */

      transaction.set(
        paymentRef,
        {

          paymentId,

          orderId,

          buyerId:
            freshOrder.buyerId,

          sellerId:
            freshOrder.sellerId ||
            null,

          listingId:
            freshOrder.listingId ||
            null,

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
      -----------------------------------------------
      FINANCIAL LEDGER
      -----------------------------------------------
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
            freshOrder.sellerId ||
            null,

          listingId:
            freshOrder.listingId ||
            null,

          amount:
            paidAmount,

          currency:
            "KES",

          commissionRate:
            freshOrder.commissionRate ||
            0,

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
        freshOrder.commissionAmount ||
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
EXPORT
=========================================================
*/

module.exports = {

  initiateMarketplacePayment,

  processMarketplacePayment,

  getPayment,

};