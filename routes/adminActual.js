const express =
  require("express");

const router =
  express.Router();


const {

  addCompanyExpense,

  getActualCompanyPosition,

  getCompanyExpenses,

  getCompanyExpense,

  voidCompanyExpense,

} =
  require(
    "../services/companyExpenses"
  );


/* =========================================================
   GET ACTUAL COMPANY POSITION

   GET
   /api/admin/actual
========================================================= */

router.get(
  "/",
  async (req, res) => {

    try {

      const result =
        await getActualCompanyPosition();


      return res.status(200).json({

        success: true,

        data: result,

      });

    } catch (error) {

      console.error(
        "❌ Get actual company position error:",
        error
      );


      return res.status(500).json({

        success: false,

        message:
          error.message ||
          "Failed to load actual company position.",

      });

    }

  }
);


/* =========================================================
   ADD COMPANY EXPENSE

   POST
   /api/admin/actual/expense
========================================================= */

router.post(
  "/expense",
  async (req, res) => {

    try {

      const {

        amount,

        category,

        description,

        reference,

        paymentMethod,

        adminId,

      } = req.body;


      /* ---------------------------------------------------
         VALIDATE AMOUNT
      --------------------------------------------------- */

      if (
        amount === undefined ||
        amount === null ||
        Number(amount) <= 0
      ) {

        return res.status(400).json({

          success: false,

          message:
            "Valid expense amount is required.",

        });

      }


      /* ---------------------------------------------------
         VALIDATE CATEGORY
      --------------------------------------------------- */

      if (
        !category ||
        !category.trim()
      ) {

        return res.status(400).json({

          success: false,

          message:
            "Expense category is required.",

        });

      }


      /* ---------------------------------------------------
         VALIDATE DESCRIPTION
      --------------------------------------------------- */

      if (
        !description ||
        !description.trim()
      ) {

        return res.status(400).json({

          success: false,

          message:
            "Expense description is required.",

        });

      }


      /* ---------------------------------------------------
         CREATE EXPENSE
      --------------------------------------------------- */

      const result =
        await addCompanyExpense({

          amount,

          category,

          description,

          reference,

          paymentMethod:
            paymentMethod ||
            "OFFLINE",

          adminId:
            adminId || null,

        });


      /* ---------------------------------------------------
         GET UPDATED POSITION
      --------------------------------------------------- */

      const position =
        await getActualCompanyPosition();


      /* ---------------------------------------------------
         RESPONSE
      --------------------------------------------------- */

      return res.status(201).json({

        success: true,

        message:
          "Company expense recorded successfully.",

        expense: result,

        position,

      });

    } catch (error) {

      console.error(
        "❌ Add company expense error:",
        error
      );


      return res.status(500).json({

        success: false,

        message:
          error.message ||
          "Failed to record company expense.",

      });

    }

  }
);


/* =========================================================
   GET EXPENSE HISTORY

   GET
   /api/admin/actual/expenses
========================================================= */

router.get(
  "/expenses",
  async (req, res) => {

    try {

      const expenses =
        await getCompanyExpenses();


      return res.status(200).json({

        success: true,

        count:
          expenses.length,

        expenses,

      });

    } catch (error) {

      console.error(
        "❌ Get expenses error:",
        error
      );


      return res.status(500).json({

        success: false,

        message:
          error.message ||
          "Failed to load company expenses.",

      });

    }

  }
);


/* =========================================================
   GET SINGLE EXPENSE

   GET
   /api/admin/actual/expenses/:expenseId
========================================================= */

router.get(
  "/expenses/:expenseId",
  async (req, res) => {

    try {

      const expense =
        await getCompanyExpense(
          req.params.expenseId
        );


      return res.status(200).json({

        success: true,

        expense,

      });

    } catch (error) {

      console.error(
        "❌ Get expense error:",
        error
      );


      return res.status(404).json({

        success: false,

        message:
          error.message ||
          "Expense not found.",

      });

    }

  }
);


/* =========================================================
   VOID EXPENSE

   PATCH
   /api/admin/actual/expenses/:expenseId/void
========================================================= */

router.patch(
  "/expenses/:expenseId/void",
  async (req, res) => {

    try {

      const {
        adminId,
      } = req.body;


      const result =
        await voidCompanyExpense({

          expenseId:
            req.params.expenseId,

          adminId,

        });


      /* ---------------------------------------------------
         GET UPDATED POSITION
      --------------------------------------------------- */

      const position =
        await getActualCompanyPosition();


      return res.status(200).json({

        success: true,

        message:
          "Expense voided successfully.",

        result,

        position,

      });

    } catch (error) {

      console.error(
        "❌ Void expense error:",
        error
      );


      return res.status(400).json({

        success: false,

        message:
          error.message ||
          "Failed to void expense.",

      });

    }

  }
);


module.exports = router;