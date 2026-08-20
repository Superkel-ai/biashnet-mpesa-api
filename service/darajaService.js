const axios =
    require("axios");

const {
    DARajaConfig
} = require("../config/daraja");


let cachedToken = null;
let tokenExpiresAt = 0;


/*
=========================================================
GET ACCESS TOKEN
=========================================================
*/

async function getAccessToken() {

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
            `${DARajaConfig.consumerKey}:${DARajaConfig.consumerSecret}`
        ).toString("base64");


    const response =
        await axios.get(
            DARajaConfig.oauthUrl,
            {

                headers: {

                    Authorization:
                        `Basic ${auth}`,

                },

            }
        );


    cachedToken =
        response.data.access_token;


    /*
    Leave a safety margin before expiry.
    */

    const expiresIn =
        Number(
            response.data.expires_in ||
            3599
        );


    tokenExpiresAt =
        now +
        Math.max(
            60,
            expiresIn - 60
        ) * 1000;


    return cachedToken;

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
        value.startsWith("0")
    ) {

        value =
            "254" +
            value.substring(1);

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
        `${yyyy}${MM}${dd}${HH}${mm}${ss}`
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

    const token =
        await getAccessToken();


    const normalizedPhone =
        normalizePhone(phone);


    const timestamp =
        getTimestamp();


    const password =
        Buffer.from(
            DARajaConfig.shortCode +
            DARajaConfig.passKey +
            timestamp
        ).toString("base64");


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
                    Number(amount),

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

                },

            }

        );


    return response.data;

}


module.exports = {

    getAccessToken,

    stkPush,

    normalizePhone,

};