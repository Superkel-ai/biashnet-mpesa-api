const {
    db
} = require("../config/firebase");

const {
    COLLECTIONS
} = require("../config/collections");


async function getIdempotencyRecord(
    key
) {

    if (!key) {
        return null;
    }


    const ref =
        db
            .collection(
                COLLECTIONS.PAYMENT_IDEMPOTENCY
            )
            .doc(key);


    const snap =
        await ref.get();


    if (!snap.exists) {
        return null;
    }


    return {
        ref,
        data: snap.data(),
    };

}


async function saveIdempotencyRecord({

    key,

    userId,

    operation,

    response,

}) {

    if (!key) {

        throw new Error(
            "Idempotency key is required."
        );

    }


    await db
        .collection(
            COLLECTIONS.PAYMENT_IDEMPOTENCY
        )
        .doc(key)
        .set({

            key,

            userId,

            operation,

            response,

            createdAt:
                new Date(),

        });

}


module.exports = {

    getIdempotencyRecord,

    saveIdempotencyRecord,

};