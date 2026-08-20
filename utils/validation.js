/*
=========================================================
PAYMENT VALIDATION
=========================================================
*/

function requireValue(
    value,
    field
) {

    if (
        value === undefined ||
        value === null ||
        String(value).trim() === ""
    ) {

        throw new Error(
            `${field} is required.`
        );

    }

}


function validateAmount(
    amount
) {

    const value =
        Number(amount);


    if (
        !Number.isFinite(value) ||
        value <= 0
    ) {

        throw new Error(
            "Invalid payment amount."
        );

    }


    return value;

}


function normalizeKenyanPhone(
    phone
) {

    requireValue(
        phone,
        "Phone number"
    );


    let value =
        String(phone)
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
        value.startsWith("0") &&
        value.length === 10
    ) {

        value =
            "254" +
            value.substring(1);

    }


    if (
        !/^2547\d{8}$/.test(value)
    ) {

        throw new Error(
            "Invalid Kenyan M-PESA phone number."
        );

    }


    return value;

}


module.exports = {

    requireValue,

    validateAmount,

    normalizeKenyanPhone,

};