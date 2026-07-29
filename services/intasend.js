const IntaSend = require("intasend-node");

const intasend = new IntaSend(
  process.env.INTASEND_PUBLIC_KEY,
  process.env.INTASEND_SECRET_KEY,
  false // false = LIVE, true = SANDBOX
);

const collection = intasend.collection();

/**
 * Initiate M-Pesa STK Push
 */
async function initiatePayment(phone, amount, apiRef) {
  try {
    const response = await collection.mpesaStkPush({
      phone_number: phone,
      name: "BIASHNET User",
      email: "payments@biashnet.co.ke",
      amount: Number(amount),
      api_ref: apiRef,
    });

    return response;
  } catch (error) {
    throw error;
  }
}

module.exports = {
  initiatePayment,
};