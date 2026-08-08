const express = require("express");

const router =
  express.Router();


const {
  recordOfflineInvestment
} = require(
  "../services/investorInvestment"
);


const {
  updateInvestmentStats
} = require(
  "../services/investmentStats"
);


/* =========================
   RECORD OFFLINE INVESTMENT
========================= */

router.post(
  "/offline-investment",
  async (req, res) => {

    try {

      const {
        userId,
        amount,
        reference,
        paymentMethod,
        note,
        adminId
      } = req.body;


      /* =========================
         VALIDATION
      ========================= */

      if (!userId) {

        return res.status(400).json({

          success: false,

          message:
            "Investor ID is required."

        });

      }


      if (
        amount === undefined ||
        amount === null ||
        Number(amount) <= 0
      ) {

        return res.status(400).json({

          success: false,

          message:
            "Valid investment amount is required."

        });

      }


      /* =========================
         RECORD INVESTMENT
      ========================= */

      const result =
        await recordOfflineInvestment({

          userId,

          amount,

          reference,

          paymentMethod:
            paymentMethod || "OFFLINE",

          note,

          adminId,

        });


      /* =========================
         REFRESH COMPANY STATS
      ========================= */

      await updateInvestmentStats();


      /* =========================
         RESPONSE
      ========================= */

      return res.status(201).json({

        success: true,

        message:
          "Offline investment recorded successfully.",

        transactionId:
          result.transactionId,

        userId:
          result.userId,

        amount:
          result.amount,

      });


    } catch (error) {

      console.error(
        "❌ Offline investment error:",
        error
      );


      return res.status(500).json({

        success: false,

        message:
          error.message ||
          "Failed to record offline investment."

      });

    }

  }
);


module.exports = router;