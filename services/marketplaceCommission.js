const { db } = require("../config/firebase");


/*
=========================================================
DEFAULT COMMISSION
=========================================================
*/

const DEFAULT_COMMISSION_RATE = 0.15;


/*
=========================================================
CATEGORY COMMISSION TABLE

Rates are decimals:

10% = 0.10
15% = 0.15
20% = 0.20
=========================================================
*/

const COMMISSION_RATES = {

    electronics: 0.10,

    phones: 0.10,

    laptops: 0.10,

    fashion: 0.12,

    shoes: 0.12,

    food: 0.10,

    beauty: 0.12,

    services: 0.15,

    housing: 0.20,

    vehicles: 0.10,

    accessories: 0.12,

    books: 0.10,

    general: 0.15,

};


/*
=========================================================
NORMALIZE CATEGORY
=========================================================
*/

function normalizeCategory(category) {

    if (!category) {
        return "general";
    }

    return String(category)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");

}


/*
=========================================================
GET COMMISSION RATE
=========================================================
*/

async function getCommissionRate(category) {

    const normalizedCategory =
        normalizeCategory(category);


    /*
    -----------------------------------------------------
    OPTIONAL FIRESTORE OVERRIDE
    -----------------------------------------------------

    marketplaceSettings/commissions

    Example:

    {
        electronics: 0.10,
        fashion: 0.12,
        services: 0.15
    }

    -----------------------------------------------------
    */

    try {

        const settingsRef =
            db
                .collection("marketplaceSettings")
                .doc("commissions");


        const settingsSnap =
            await settingsRef.get();


        if (settingsSnap.exists) {

            const settings =
                settingsSnap.data();


            const configuredRate =
                settings[normalizedCategory];


            if (
                configuredRate !== undefined &&
                Number.isFinite(
                    Number(configuredRate)
                ) &&
                Number(configuredRate) >= 0 &&
                Number(configuredRate) <= 1
            ) {

                return Number(
                    configuredRate
                );

            }

        }

    } catch (error) {

        console.error(
            "Commission settings lookup failed:",
            error
        );

        /*
        -------------------------------------------------
        We intentionally fall back to the backend
        default instead of stopping an order.
        -------------------------------------------------
        */

    }


    return (
        COMMISSION_RATES[
            normalizedCategory
        ] ??
        DEFAULT_COMMISSION_RATE
    );

}


/*
=========================================================
CALCULATE COMMISSION
=========================================================
*/

async function calculateCommission({
    amount,
    category,
}) {

    const saleAmount =
        Number(amount);


    if (
        !Number.isFinite(saleAmount) ||
        saleAmount <= 0
    ) {

        throw new Error(
            "Invalid sale amount."
        );

    }


    const commissionRate =
        await getCommissionRate(
            category
        );


    const commissionAmount =
        Number(
            (
                saleAmount *
                commissionRate
            ).toFixed(2)
        );


    const sellerGross =
        Number(
            (
                saleAmount -
                commissionAmount
            ).toFixed(2)
        );


    return {

        category:
            normalizeCategory(category),

        commissionRate,

        commissionPercentage:
            commissionRate * 100,

        commissionAmount,

        sellerGross,

        saleAmount,

    };

}


module.exports = {

    getCommissionRate,

    calculateCommission,

    normalizeCategory,

};