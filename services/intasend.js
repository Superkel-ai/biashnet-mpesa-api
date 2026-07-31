const axios = require("axios");

async function initiatePayment(phone, amount, apiRef) {
  try {

    const response = await axios.post(
      "https://payment.intasend.com/api/v1/payment/mpesa-stk-push/",
      {
        phone_number: phone,
        name: "BIASHNET User",
        email: "payments@biashnet.co.ke",
        amount: Number(amount),
        currency: "KES",
        api_ref: apiRef,
        method: "M-PESA"
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.INTASEND_SECRET_KEY}`,
          INTASEND_PUBLIC_API_KEY: process.env.INTASEND_PUBLIC_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    console.log(
      "INTASEND RESPONSE:",
      JSON.stringify(response.data, null, 2)
    );

    return response.data;

  } catch (error) {

    console.error(
      "INTASEND API ERROR:",
      error.response?.data || error.message
    );

    throw error;
  }
}

module.exports = {
  initiatePayment,
};