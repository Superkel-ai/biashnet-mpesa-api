require("dotenv").config();

const DARajaConfig = {

    consumerKey:
        process.env.MPESA_CONSUMER_KEY,

    consumerSecret:
        process.env.MPESA_CONSUMER_SECRET,

    shortCode:
        process.env.MPESA_SHORTCODE,

    passKey:
        process.env.MPESA_PASSKEY,

    callbackUrl:
        process.env.CALLBACK_URL,

    oauthUrl:
        "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",

    stkPushUrl:
        "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",

};

function validateDarajaConfig() {

    const required = {

        MPESA_CONSUMER_KEY:
            DARajaConfig.consumerKey,

        MPESA_CONSUMER_SECRET:
            DARajaConfig.consumerSecret,

        MPESA_SHORTCODE:
            DARajaConfig.shortCode,

        MPESA_PASSKEY:
            DARajaConfig.passKey,

        CALLBACK_URL:
            DARajaConfig.callbackUrl,

    };


    const missing =
        Object.entries(required)
            .filter(
                ([, value]) =>
                    !value
            )
            .map(
                ([key]) =>
                    key
            );


    if (missing.length > 0) {

        throw new Error(
            `Missing M-PESA configuration: ${missing.join(", ")}`
        );

    }

}


module.exports = {

    DARajaConfig,

    validateDarajaConfig,

};