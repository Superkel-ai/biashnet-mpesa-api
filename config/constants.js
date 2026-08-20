/**
 * BIASHNET PAYMENT SYSTEM
 * Financial Constants & State Definitions
 *
 * IMPORTANT:
 * These values define the backend financial state machine.
 * Do not allow frontend clients to directly set these states.
 */

const PAYMENT_STATUS = Object.freeze({
  PENDING: "pending",
  COMPLETED: "completed",
  FAILED: "failed",
  REVERSED: "reversed",
});

const ORDER_STATUS = Object.freeze({
  PENDING_PAYMENT: "PENDING_PAYMENT",
  PAID: "PAID",
  PROCESSING: "PROCESSING",
  SHIPPED: "SHIPPED",
  READY_FOR_PICKUP: "READY_FOR_PICKUP",
  DELIVERED: "DELIVERED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  REFUNDED: "REFUNDED",
  DISPUTED: "DISPUTED",
});

const PAYMENT_TRANSFER_STATUS = Object.freeze({
  PENDING: "pending",
  COMPLETED: "completed",
  FAILED: "failed",
  REVERSED: "reversed",
  ON_HOLD: "on_hold",
});

const PAYMENT_METHOD = Object.freeze({
  MPESA: "MPESA",
});

const TRANSACTION_STATUS = Object.freeze({
  PENDING: "pending",
  COMPLETED: "completed",
  FAILED: "failed",
  REVERSED: "reversed",
  CANCELLED: "cancelled",
});

const TRANSACTION_TYPE = Object.freeze({
  ORDER_PAYMENT: "ORDER_PAYMENT",

  SELLER_SETTLEMENT: "SELLER_SETTLEMENT",

  SELLER_WITHDRAWAL: "SELLER_WITHDRAWAL",

  REFUND: "REFUND",

  PLATFORM_REVENUE: "PLATFORM_REVENUE",

  WALLET_CREDIT: "WALLET_CREDIT",

  WALLET_DEBIT: "WALLET_DEBIT",

  ADJUSTMENT: "ADJUSTMENT",
});

const WALLET_OWNER_TYPE = Object.freeze({
  PLATFORM: "platform",
  SELLER: "seller",
});

const WALLET_STATUS = Object.freeze({
  ACTIVE: "active",
  SUSPENDED: "suspended",
  CLOSED: "closed",
});

const WALLET_BALANCE_TYPE = Object.freeze({
  PENDING: "pending",
  AVAILABLE: "available",
  LOCKED: "locked",
});

const PAYMENT_TRANSFER_TYPE = Object.freeze({
  SELLER_SETTLEMENT: "SELLER_SETTLEMENT",
  SELLER_WITHDRAWAL: "SELLER_WITHDRAWAL",
  REFUND: "REFUND",
});

const IDEMPOTENCY_STATUS = Object.freeze({
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
});

const CURRENCY = Object.freeze({
  KES: "KES",
});

const PLATFORM = Object.freeze({
  ID: "BIASHNET_PLATFORM",
  TYPE: "platform",
});

module.exports = {
  PAYMENT_STATUS,
  ORDER_STATUS,
  PAYMENT_TRANSFER_STATUS,
  PAYMENT_METHOD,
  TRANSACTION_STATUS,
  TRANSACTION_TYPE,
  WALLET_OWNER_TYPE,
  WALLET_STATUS,
  WALLET_BALANCE_TYPE,
  PAYMENT_TRANSFER_TYPE,
  IDEMPOTENCY_STATUS,
  CURRENCY,
  PLATFORM,
};