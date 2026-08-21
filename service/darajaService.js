const axios =
    require("axios");

const {
    DARajaConfig,
    validateDarajaConfig,
} =
    require("../config/daraja");


let cachedToken = null;
let tokenExpiresAt = 0;


/*
=========================================================
GET ACCESS TOKEN
=========================================================
*/

async function getAccessToken() {

    validateDarajaConfig();

    const now =
        Date.now();


    if (
        cachedToken &&
        now < tokenExpiresAt
    ) {

        return cachedToken;

    }


    const auth =
        Buffer.from(
            `${DARajaConfig.consumerKey}:` +
            `${DARajaConfig.consumerSecret}`
        ).toString("base64");


    try {

        const response =
            await axios.get(
                DARajaConfig.oauthUrl,
                {
                    headers: {

                        Authorization:
                            `Basic ${auth}`,

                    },

                    timeout: 15000,

                }
            );


        const token =
            response.data?.access_token;


        if (!token) {

            throw new Error(
                "M-PESA access token was not returned."
            );

        }


        cachedToken =
            token;


        const expiresIn =
            Number(
                response.data?.expires_in ||
                3599
            );


        tokenExpiresAt =
            now +
            Math.max(
                60,
                expiresIn - 60
            ) * 1000;


        return cachedToken;

    } catch (error) {

        console.error(
            "❌ M-PESA OAuth error:",
            error.response?.data ||
            error.message
        );


        throw new Error(
            error.response?.data?.errorMessage ||
            "Unable to obtain M-PESA access token."
        );

    }

}


/*
=========================================================
NORMALIZE PHONE
=========================================================
*/

function normalizePhone(phone) {

    let value =
        String(phone || "")
            .trim()
            .replace(/\s+/g, "")
            .replace(/-/g, "");


    if (
        value.startsWith("+254")
    ) {

        value =
            value.substring(1);

    }


    if (
        value.startsWith("07") ||
        value.startsWith("01")
    ) {

        value =
            "254" +
            value.substring(1);

    }


    if (
        !/^254[71]\d{8}$/.test(value)
    ) {

        throw new Error(
            "Invalid Kenyan M-PESA phone number."
        );

    }


    return value;

}


/*
=========================================================
TIMESTAMP
=========================================================
*/

function getTimestamp() {

    const now =
        new Date();


    const yyyy =
        now.getFullYear();

    const MM =
        String(
            now.getMonth() + 1
        ).padStart(2, "0");

    const dd =
        String(
            now.getDate()
        ).padStart(2, "0");

    const HH =
        String(
            now.getHours()
        ).padStart(2, "0");

    const mm =
        String(
            now.getMinutes()
        ).padStart(2, "0");

    const ss =
        String(
            now.getSeconds()
        ).padStart(2, "0");


    return (
        `${yyyy}${MM}${dd}` +
        `${HH}${mm}${ss}`
    );

}


/*
=========================================================
STK PUSH
=========================================================
*/

async function stkPush({

    phone,

    amount,

    accountReference,

    transactionDesc,

}) {

    const normalizedPhone =
        normalizePhone(phone);


    const numericAmount =
        Number(amount);


    if (
        !Number.isFinite(numericAmount) ||
        numericAmount <= 0
    ) {

        throw new Error(
            "Invalid M-PESA payment amount."
        );

    }


    const token =
        await getAccessToken();


    const timestamp =
        getTimestamp();


    const password =
        Buffer.from(
            DARajaConfig.shortCode +
            DARajaConfig.passKey +
            timestamp
        ).toString("base64");


    console.log(
        "📲 Sending STK Push:",
        {
            phone:
                normalizedPhone,

            amount:
                numericAmount,

            accountReference,

        }
    );


    try {

        const response =
            await axios.post(

                DARajaConfig.stkPushUrl,

                {

                    BusinessShortCode:
                        DARajaConfig.shortCode,

                    Password:
                        password,

                    Timestamp:
                        timestamp,

                    TransactionType:
                        "CustomerPayBillOnline",

                    Amount:
                        numericAmount,

                    PartyA:
                        normalizedPhone,

                    PartyB:
                        DARajaConfig.shortCode,

                    PhoneNumber:
                        normalizedPhone,

                    CallBackURL:
                        DARajaConfig.callbackUrl,

                    AccountReference:
                        accountReference,

                    TransactionDesc:
                        transactionDesc ||
                        `BIASHNET ${accountReference}`,

                },

                {

                    headers: {

                        Authorization:
                            `Bearer ${token}`,

                        "Content-Type":
                            "application/json",

                    },

                    timeout: 20000,

                }

            );


        return response.data;

    } catch (error) {

        console.error(
            "❌ STK Push error:",
            error.response?.data ||
            error.message
        );


        throw new Error(
            error.response?.data?.errorMessage ||
            error.response?.data?.errorCode ||
            "Failed to send M-PESA STK Push."
        );

    }

}


module.exports = {

    getAccessToken,

    stkPush,

    normalizePhone,

};