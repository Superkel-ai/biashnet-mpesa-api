/*
=========================================================
MONEY UTILITIES
=========================================================
*/

function money(value) {

    const number =
        Number(value);

    if (
        !Number.isFinite(number)
    ) {

        throw new Error(
            "Invalid monetary value."
        );

    }

    return Number(
        number.toFixed(2)
    );

}


function addMoney(...values) {

    return money(
        values.reduce(
            (total, value) =>
                total + Number(value || 0),
            0
        )
    );

}


function subtractMoney(
    value,
    deduction
) {

    return money(
        Number(value || 0) -
        Number(deduction || 0)
    );

}


function isValidMoney(value) {

    const number =
        Number(value);

    return (
        Number.isFinite(number) &&
        number >= 0
    );

}


module.exports = {

    money,

    addMoney,

    subtractMoney,

    isValidMoney,

};