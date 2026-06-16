const axios = require("axios");
require("dotenv").config();

let cachedToken = null;
let tokenExpiry = null;

/**
 * Normalize Kenyan phone numbers
 */
function normalizePhone(phone) {
  if (!phone) throw new Error("Phone is required");

  phone = phone.toString().trim();

  // convert 07... → 2547...
  if (phone.startsWith("0")) {
    phone = "254" + phone.substring(1);
  }

  // ensure no +
  if (phone.startsWith("+")) {
    phone = phone.substring(1);
  }

  return phone;
}

/**
 * GET ACCESS TOKEN (cached for performance)
 */
async function getAccessToken() {
  const now = Date.now();

  // reuse token if still valid
  if (cachedToken && tokenExpiry && now < tokenExpiry) {
    return cachedToken;
  }

  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString("base64");

  const url =
    "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";

  const res = await axios.get(url, {
    headers: { Authorization: `Basic ${auth}` },
    timeout: 10000,
  });

  cachedToken = res.data.access_token;

  // token usually lasts ~1 hour, we refresh early
  tokenExpiry = now + 50 * 60 * 1000;

  return cachedToken;
}

/**
 * SEND B2C PAYMENT (PRODUCTION SAFE)
 */
async function sendB2C({
  phone,
  amount,
  remarks = "Withdrawal payout",
  idempotencyKey, // IMPORTANT for deduplication
}) {
  try {
    // VALIDATION
    if (!phone) throw new Error("Phone missing");
    if (!amount || amount <= 0) throw new Error("Invalid amount");

    const PartyB = normalizePhone(phone);

    const token = await getAccessToken();

    const url =
      "https://api.safaricom.co.ke/mpesa/b2c/v1/paymentrequest";

    const payload = {
      InitiatorName: process.env.MPESA_INITIATOR,
      SecurityCredential: process.env.MPESA_SECURITY_CREDENTIAL,
      CommandID: "BusinessPayment",
      Amount: Math.round(amount),
      PartyA: process.env.MPESA_SHORTCODE,
      PartyB,
      Remarks: remarks,
      QueueTimeOutURL: process.env.B2C_TIMEOUT_URL,
      ResultURL: process.env.B2C_RESULT_URL,
      Occasion: "Withdrawal",

      // optional tracking (not required by Safaricom but useful internally)
      OriginatorConversationID: idempotencyKey || undefined,
    };

    console.log("🚀 Sending B2C:", {
      phone: PartyB,
      amount,
      idempotencyKey,
    });

    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      timeout: 15000,
    });

    console.log("✅ B2C RESPONSE:", response.data);

    return {
      success: true,
      data: response.data,
      requestId:
        response.data?.ConversationID ||
        response.data?.OriginatorConversationID,
    };
  } catch (error) {
    console.error(
      "❌ B2C ERROR:",
      error.response?.data || error.message
    );

    throw new Error(
      error.response?.data?.errorMessage ||
        error.message ||
        "B2C failed"
    );
  }
}

module.exports = { sendB2C };