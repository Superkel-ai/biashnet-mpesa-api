const express = require("express");
const router = express.Router();

const { db } = require("../config/firebase");

const { creditWallet } =
  require("../services/wallet");

const { saveTransaction } =
  require("../services/transactions");

const { createWalletIfNotExists } =
  require("../services/walletInit");

const { syncInvestor } =
  require("../services/investors");

const { updateInvestmentStats } =
  require("../services/investmentStats");

const {
  processMarketplacePayment,
} = require("../services/paymentService");


/* =========================================================
   M-PESA STK CALLBACK
========================================================= */

router.post(
  "/stk/callback",
  async (req, res) => {

    try {

      console.log(
        "🔥 M-PESA CALLBACK:",
        JSON.stringify(
          req.body,
          null,
          2
        )
      );


      /* =====================================================
         SAFARICOM CALLBACK
      ===================================================== */

      const callback =
        req.body?.Body?.stkCallback;


      if (!callback) {

        console.log(
          "⚠️ Invalid M-PESA callback body."
        );

        return res.sendStatus(200);

      }


      const checkoutRequestID =
        callback.CheckoutRequestID;


      const merchantRequestID =
        callback.MerchantRequestID;


      const resultCode =
        Number(callback.ResultCode);


      const resultDesc =
        callback.ResultDesc ||
        "";


      console.log(
        "📱 CheckoutRequestID:",
        checkoutRequestID
      );

      console.log(
        "📱 MerchantRequestID:",
        merchantRequestID
      );

      console.log(
        "📱 ResultCode:",
        resultCode
      );

      console.log(
        "📱 ResultDesc:",
        resultDesc
      );


      if (!checkoutRequestID) {

        console.log(
          "⚠️ Missing CheckoutRequestID."
        );

        return res.sendStatus(200);

      }


      /* =====================================================
         STEP 1
         CHECK MARKETPLACE PAYMENT FIRST
      ===================================================== */

      const marketplaceSnapshot =
        await db
          .collection(
            "marketplacePayments"
          )
          .where(
            "checkoutRequestID",
            "==",
            checkoutRequestID
          )
          .limit(1)
          .get();


      if (
        !marketplaceSnapshot.empty
      ) {

        const marketplaceDoc =
          marketplaceSnapshot
            .docs[0];


        const marketplacePayment =
          marketplaceDoc.data();


        console.log(
          "🛒 MARKETPLACE PAYMENT FOUND:",
          marketplaceDoc.id
        );


        /* =================================================
           MARKETPLACE PAYMENT FAILED
        ================================================= */

        if (resultCode !== 0) {

          console.log(
            "❌ MARKETPLACE PAYMENT FAILED:",
            resultCode,
            resultDesc
          );


          await marketplaceDoc.ref.update({

            status:
              "FAILED",

            resultCode,

            resultDesc,

            merchantRequestID,

            callback,

            updatedAt:
              new Date(),

          });


          /*
           * Return order to unpaid state.
           */

          if (
            marketplacePayment.orderId
          ) {

            await db
              .collection(
                "marketplaceOrders"
              )
              .doc(
                marketplacePayment.orderId
              )
              .update({

                status:
                  "PENDING_PAYMENT",

                paymentStatus:
                  "FAILED",

                updatedAt:
                  new Date(),

              });

          }


          return res.sendStatus(200);

        }


        /* =================================================
           MARKETPLACE PAYMENT SUCCESS
        ================================================= */

        console.log(
          "💰 MARKETPLACE PAYMENT SUCCESS CALLBACK"
        );


        /* =================================================
           READ CALLBACK METADATA
        ================================================= */

        const items =
          callback.CallbackMetadata
            ?.Item || [];


        const getValue =
          (name) =>
            items.find(
              (item) =>
                item.Name === name
            )?.Value;


        const amount =
          Number(
            getValue("Amount")
          );


        const receiptNumber =
          getValue(
            "MpesaReceiptNumber"
          );


        const phone =
          getValue(
            "PhoneNumber"
          );


        console.log(
          "💰 Paid amount:",
          amount
        );


        console.log(
          "🧾 M-PESA receipt:",
          receiptNumber
        );


        console.log(
          "📱 Paid phone:",
          phone
        );


        /* =================================================
           VALIDATE RECEIPT
        ================================================= */

        if (!receiptNumber) {

          console.error(
            "❌ Successful callback has no M-PESA receipt."
          );

          return res.sendStatus(200);

        }


        /* =================================================
           DUPLICATE CALLBACK PROTECTION
        ================================================= */

        if (
          marketplacePayment.status ===
          "COMPLETED"
        ) {

          console.log(
            "ℹ️ Marketplace payment already completed:",
            marketplaceDoc.id
          );

          return res.sendStatus(200);

        }


        /* =================================================
           PROCESS MARKETPLACE PAYMENT
        ================================================= */

        try {

          const result =
            await processMarketplacePayment({

              orderId:
                marketplacePayment.orderId,

              providerTransactionId:
                receiptNumber,

              amount:
                amount ||
                marketplacePayment.amount,

              paymentMethod:
                "MPESA",

              providerResponse:
                callback,

            });


          console.log(
            "✅ Marketplace payment processed:",
            JSON.stringify(
              result,
              null,
              2
            )
          );


          /* =================================================
             UPDATE PAYMENT WITH M-PESA DETAILS
          ================================================= */

          await marketplaceDoc.ref.update({

            status:
              "COMPLETED",

            resultCode,

            resultDesc,

            receiptNumber,

            transactionId:
              result.transactionId ||
              null,

            merchantRequestID,

            callback,

            receivedByPlatform:
              true,

            updatedAt:
              new Date(),

          });


          console.log(
            "✅ Marketplace payment completed successfully."
          );


        } catch (paymentError) {

          console.error(
            "❌ Marketplace payment processing error:",
            paymentError
          );


          /*
           * Do NOT blindly mark the payment successful
           * if our internal processing failed.
           *
           * Safaricom has confirmed payment, so this
           * requires investigation/retry rather than
           * pretending the payment never happened.
           */

          await marketplaceDoc.ref.update({

            resultCode,

            resultDesc,

            receiptNumber,

            merchantRequestID,

            callback,

            receivedByPlatform:
              true,

            processingError:
              paymentError.message,

            updatedAt:
              new Date(),

          });

        }


        return res.sendStatus(200);

      }


      /* =====================================================
         STEP 2
         MARKETPLACE PAYMENT NOT FOUND

         NOW CHECK INVESTOR / WALLET TRANSACTIONS
      ===================================================== */

      console.log(
        "ℹ️ Marketplace payment not found."
      );

      console.log(
        "🔎 Checking pendingTransactions..."
      );


      const pendingRef =
        db
          .collection(
            "pendingTransactions"
          )
          .doc(
            checkoutRequestID
          );


      const pendingDoc =
        await pendingRef.get();


      /* =====================================================
         NO PENDING TRANSACTION
      ===================================================== */

      if (!pendingDoc.exists) {

        console.log(
          "⚠️ Pending transaction not found:",
          checkoutRequestID
        );

        return res.sendStatus(200);

      }


      const pending =
        pendingDoc.data();


      console.log(
        "💼 Pending transaction found:",
        JSON.stringify(
          pending,
          null,
          2
        )
      );


      /* =====================================================
         INVESTOR / WALLET PAYMENT FAILED
      ===================================================== */

      if (resultCode !== 0) {

        await pendingRef.update({

          status:
            "FAILED",

          resultCode,

          resultDesc,

          callback,

          updatedAt:
            new Date(),

        });


        console.log(
          "❌ Pending payment marked FAILED."
        );


        return res.sendStatus(200);

      }


      /* =====================================================
         READ CALLBACK METADATA
      ===================================================== */

      const items =
        callback.CallbackMetadata
          ?.Item || [];


      const getValue =
        (name) =>
          items.find(
            (item) =>
              item.Name === name
          )?.Value;


      const amount =
        Number(
          getValue("Amount")
        ) ||
        Number(
          pending.amount
        );


      const receiptNumber =
        getValue(
          "MpesaReceiptNumber"
        );


      const phone =
        String(
          getValue("PhoneNumber") ||
          pending.phone ||
          ""
        );


      /* =====================================================
         DUPLICATE PROTECTION
      ===================================================== */

      if (
        pending.status ===
        "SUCCESS"
      ) {

        console.log(
          "ℹ️ Already processed:",
          checkoutRequestID
        );

        return res.sendStatus(200);

      }


      /* =====================================================
         CREATE WALLET
      ===================================================== */

      await createWalletIfNotExists(
        pending.userId,
        phone
      );


      /* =====================================================
         SAVE TRANSACTION
      ===================================================== */

      await saveTransaction({

        checkoutRequestID,

        receiptNumber,

        userId:
          pending.userId,

        phone,

        amount,

        type:
          "DEPOSIT",

        status:
          "SUCCESS",

        provider:
          "MPESA",

      });


      /* =====================================================
         CREDIT WALLET
      ===================================================== */

      await creditWallet({

        userId:
          pending.userId,

        phone,

        amount,

        receiptNumber,

      });


      /* =====================================================
         INVESTOR SYNC
      ===================================================== */

      await syncInvestor(
        pending.userId
      );


      await updateInvestmentStats();


      /* =====================================================
         MARK PENDING SUCCESS
      ===================================================== */

      await pendingRef.update({

        status:
          "SUCCESS",

        receiptNumber,

        resultCode,

        resultDesc,

        callback,

        updatedAt:
          new Date(),

      });


      console.log(
        "✅ Wallet credited:",
        pending.userId,
        amount
      );


      return res.sendStatus(200);


    } catch (err) {

      console.error(
        "❌ M-PESA Callback Error:",
        err
      );


      /*
       * Always acknowledge Safaricom.
       */

      return res.sendStatus(200);

    }

  }
);


module.exports = router;