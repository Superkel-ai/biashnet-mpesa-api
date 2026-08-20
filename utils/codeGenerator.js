const crypto = require("crypto");


/*
=========================================================
BIASHNET ID & CODE GENERATOR
=========================================================

RESPONSIBILITIES

- Order IDs
- Payment IDs
- Transaction IDs
- Withdrawal IDs
- Refund IDs
- Order completion codes
- Completion-code normalization
- Secure completion-code hashing
- Completion-code verification


SECURITY RULE

The buyer receives the plain completion code.

Firestore stores ONLY the hash.

Example:

Buyer:
    482731

Firestore:
    SHA-256 hash of 482731


The plain completion code must NEVER be stored
inside the order document.
=========================================================
*/


/*
=========================================================
RANDOM STRING
=========================================================

Generates cryptographically secure random
uppercase hexadecimal characters.

Example:

randomString(6)

=> A8F21C
=========================================================
*/

function randomString(length = 8) {

    if (
        !Number.isInteger(length) ||
        length <= 0 ||
        length > 128
    ) {

        throw new Error(
            "Random string length must be between 1 and 128."
        );

    }


    /*
    Each byte produces two hexadecimal
    characters.

    Generate enough bytes to guarantee
    the requested length.
    */

    const bytes =
        crypto.randomBytes(
            Math.ceil(length / 2)
        );


    return bytes
        .toString("hex")
        .slice(0, length)
        .toUpperCase();

}


/*
=========================================================
INTERNAL ID GENERATOR
=========================================================

Creates IDs in the format:

PREFIX-TIMESTAMP-RANDOM

Example:

ORD-1755681234567-A8F21C9D
=========================================================
*/

function generatePrefixedId(
    prefix
) {

    return (
        `${prefix}-${Date.now()}-` +
        randomString(8)
    );

}


/*
=========================================================
ORDER ID
=========================================================

Example:

ORD-1755681234567-A8F21C9D
=========================================================
*/

function generateOrderId() {

    return generatePrefixedId(
        "ORD"
    );

}


/*
=========================================================
PAYMENT ID
=========================================================

Example:

PAY-1755681234567-91BC72F8
=========================================================
*/

function generatePaymentId() {

    return generatePrefixedId(
        "PAY"
    );

}


/*
=========================================================
TRANSACTION ID
=========================================================

Example:

TXN-1755681234567-F83A21D4
=========================================================
*/

function generateTransactionId() {

    return generatePrefixedId(
        "TXN"
    );

}


/*
=========================================================
WITHDRAWAL ID
=========================================================

Example:

WD-1755681234567-A8F21C9D
=========================================================
*/

function generateWithdrawalId() {

    return generatePrefixedId(
        "WD"
    );

}


/*
=========================================================
REFUND ID
=========================================================

Example:

REF-1755681234567-91BC72F8
=========================================================
*/

function generateRefundId() {

    return generatePrefixedId(
        "REF"
    );

}


/*
=========================================================
GENERATE ORDER COMPLETION CODE
=========================================================

The completion code is:

- generated ONLY by backend
- exactly 6 digits
- cryptographically random
- shown to buyer after successful payment

Example:

482731


IMPORTANT:

This is NOT the order ID.

Order ID:

ORD-1755681234567-A8F21C9D

Completion code:

482731
=========================================================
*/

function generateCompletionCode() {

    /*
    crypto.randomInt is cryptographically secure.

    Minimum:
        100000

    Maximum:
        999999
    */

    return String(
        crypto.randomInt(
            100000,
            1000000
        )
    );

}


/*
=========================================================
NORMALIZE COMPLETION CODE
=========================================================

Converts user input into the canonical format.

Examples:

"482731"
    ↓
"482731"

" 482731 "
    ↓
"482731"

"48 2731"
    ↓
"482731"


This prevents harmless formatting differences
from causing verification failures.
=========================================================
*/

function normalizeCompletionCode(
    code
) {

    if (
        code === undefined ||
        code === null
    ) {

        return "";

    }


    return String(code)
        .trim()
        .replace(/\s+/g, "");

}


/*
=========================================================
VALIDATE COMPLETION CODE FORMAT
=========================================================

Valid format:

Exactly 6 numeric digits.

Examples:

482731   → valid
123456   → valid

12345    → invalid
1234567  → invalid
ABC123   → invalid
12 3456  → valid after normalization
=========================================================
*/

function isValidCompletionCode(
    code
) {

    const normalized =
        normalizeCompletionCode(
            code
        );


    return /^\d{6}$/.test(
        normalized
    );

}


/*
=========================================================
HASH COMPLETION CODE
=========================================================

The code is normalized before hashing.

This means:

"482731"

and:

" 482731 "

produce the same hash.

Firestore stores ONLY this hash.

=========================================================
*/

function hashCompletionCode(
    code
) {

    const normalizedCode =
        normalizeCompletionCode(
            code
        );


    if (
        !isValidCompletionCode(
            normalizedCode
        )
    ) {

        throw new Error(
            "Completion code must contain exactly 6 digits."
        );

    }


    return crypto
        .createHash("sha256")
        .update(
            normalizedCode,
            "utf8"
        )
        .digest("hex");

}


/*
=========================================================
VERIFY COMPLETION CODE
=========================================================

Seller submits:

482731

Backend:

1. Normalize
2. Validate
3. Hash
4. Compare against stored hash


Returns:

true

or:

false
=========================================================
*/

function verifyCompletionCode(
    code,
    storedHash
) {

    /*
    -----------------------------------------------------
    BASIC VALIDATION
    -----------------------------------------------------
    */

    if (
        !storedHash
    ) {

        return false;

    }


    const normalizedCode =
        normalizeCompletionCode(
            code
        );


    /*
    -----------------------------------------------------
    CODE FORMAT
    -----------------------------------------------------
    */

    if (
        !isValidCompletionCode(
            normalizedCode
        )
    ) {

        return false;

    }


    /*
    -----------------------------------------------------
    HASH INCOMING CODE
    -----------------------------------------------------
    */

    let incomingHash;

    try {

        incomingHash =
            hashCompletionCode(
                normalizedCode
            );

    } catch (
        error
    ) {

        return false;

    }


    /*
    -----------------------------------------------------
    NORMALIZE STORED HASH
    -----------------------------------------------------
    */

    const normalizedStoredHash =
        String(
            storedHash
        )
            .trim()
            .toLowerCase();


    /*
    SHA-256 produces exactly
    64 hexadecimal characters.
    */

    if (
        !/^[a-f0-9]{64}$/.test(
            normalizedStoredHash
        )
    ) {

        return false;

    }


    /*
    -----------------------------------------------------
    CONSTANT-TIME COMPARISON
    -----------------------------------------------------

    Prevent simple timing-based comparison attacks.
    -----------------------------------------------------
    */

    const incomingBuffer =
        Buffer.from(
            incomingHash,
            "hex"
        );


    const storedBuffer =
        Buffer.from(
            normalizedStoredHash,
            "hex"
        );


    if (
        incomingBuffer.length !==
        storedBuffer.length
    ) {

        return false;

    }


    return crypto.timingSafeEqual(
        incomingBuffer,
        storedBuffer
    );

}


/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

    randomString,

    generateOrderId,

    generatePaymentId,

    generateTransactionId,

    generateCompletionCode,

    generateWithdrawalId,

    generateRefundId,

    normalizeCompletionCode,

    isValidCompletionCode,

    hashCompletionCode,

    verifyCompletionCode,

};