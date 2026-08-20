/*
=========================================================
PAYMENT CONSTANTS
=========================================================
*/

const PAYMENT_METHODS = {

    MPESA:
        "MPESA",

    CARD:
        "CARD",

    WALLET:
        "WALLET",

};


const PAYMENT_PROVIDERS = {

    MPESA:
        "MPESA",

    INTASEND:
        "INTASEND",

};


const PAYMENT_STATUS = {

    PENDING:
        "PENDING",

    INITIATED:
        "INITIATED",

    COMPLETED:
        "COMPLETED",

    FAILED:
        "FAILED",

    CANCELLED:
        "CANCELLED",

    REFUNDED:
        "REFUNDED",

};


const ORDER_STATUS = {

    PENDING_PAYMENT:
        "PENDING_PAYMENT",

    PAYMENT_INITIATED:
        "PAYMENT_INITIATED",

    PAID:
        "PAID",

    PROCESSING:
        "PROCESSING",

    READY_FOR_DELIVERY:
        "READY_FOR_DELIVERY",

    OUT_FOR_DELIVERY:
        "OUT_FOR_DELIVERY",

    COMPLETED:
        "COMPLETED",

    CANCELLED:
        "CANCELLED",

    REFUNDED:
        "REFUNDED",

};


const SELLER_PAYMENT_STATUS = {

    NOT_RELEASED:
        "NOT_RELEASED",

    HELD:
        "HELD",

    RELEASED:
        "RELEASED",

    REFUNDED:
        "REFUNDED",

};


const PAYOUT_STATUS = {

    NOT_RELEASED:
        "NOT_RELEASED",

    PENDING:
        "PENDING",

    PROCESSING:
        "PROCESSING",

    COMPLETED:
        "COMPLETED",

    FAILED:
        "FAILED",

};


const TRANSACTION_TYPES = {

    MARKETPLACE_SALE:
        "MARKETPLACE_SALE",

    COMMISSION:
        "COMMISSION",

    SELLER_PAYOUT:
        "SELLER_PAYOUT",

    WALLET_DEPOSIT:
        "WALLET_DEPOSIT",

    WALLET_WITHDRAWAL:
        "WALLET_WITHDRAWAL",

    REFUND:
        "REFUND",

};

const ORDER_CODE_STATUS = {

    NOT_GENERATED:
        "NOT_GENERATED",

    ACTIVE:
        "ACTIVE",

    USED:
        "USED",

    EXPIRED:
        "EXPIRED",

    CANCELLED:
        "CANCELLED",

};


const MIN_WITHDRAWAL_AMOUNT = 10;


module.exports = {

    PAYMENT_METHODS,

    PAYMENT_PROVIDERS,

    PAYMENT_STATUS,

    ORDER_STATUS,

    SELLER_PAYMENT_STATUS,

    PAYOUT_STATUS,

    TRANSACTION_TYPES,

    ORDER_CODE_STATUS,

    MIN_WITHDRAWAL_AMOUNT,

};