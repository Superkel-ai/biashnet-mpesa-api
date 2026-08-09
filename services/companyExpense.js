const { db } = require("../config/firebase");
const { FieldValue } = require("firebase-admin/firestore");


/* =========================================================
   ADD COMPANY EXPENSE
========================================================= */

async function addCompanyExpense({
  amount,
  category,
  description,
  reference = "",
  paymentMethod = "OFFLINE",
  adminId = null,
}) {

  const expenseAmount = Number(amount);

  /* -------------------------------------------------------
     VALIDATE AMOUNT
  ------------------------------------------------------- */

  if (
    !Number.isFinite(expenseAmount) ||
    expenseAmount <= 0
  ) {
    throw new Error("Invalid expense amount.");
  }


  /* -------------------------------------------------------
     VALIDATE DESCRIPTION
  ------------------------------------------------------- */

  if (
    !description ||
    !description.trim()
  ) {
    throw new Error(
      "Expense description is required."
    );
  }


  /* -------------------------------------------------------
     VALIDATE CATEGORY
  ------------------------------------------------------- */

  if (
    !category ||
    !category.trim()
  ) {
    throw new Error(
      "Expense category is required."
    );
  }


  /* -------------------------------------------------------
     CREATE EXPENSE
  ------------------------------------------------------- */

  const expenseRef =
    db.collection("expenses").doc();

  const expenseId =
    expenseRef.id;


  const now =
    FieldValue.serverTimestamp();


  const expenseData = {

    expenseId,

    amount:
      expenseAmount,

    category:
      category.trim(),

    description:
      description.trim(),

    reference:
      reference
        ? reference.trim()
        : null,

    paymentMethod:
      paymentMethod || "OFFLINE",

    adminId:
      adminId || null,

    status:
      "COMPLETED",

    createdAt:
      now,

    updatedAt:
      now,

  };


  /* -------------------------------------------------------
     SAVE EXPENSE

     IMPORTANT:
     We DO NOT modify investmentStats here.
  ------------------------------------------------------- */

  await expenseRef.set(
    expenseData
  );


  /* -------------------------------------------------------
     RETURN
  ------------------------------------------------------- */

  return {

    success: true,

    expenseId,

    amount:
      expenseAmount,

    category:
      category.trim(),

    description:
      description.trim(),

  };

}


/* =========================================================
   GET ACTUAL COMPANY POSITION
========================================================= */

async function getActualCompanyPosition() {

  /* -------------------------------------------------------
     GET INVESTMENT STATS
  ------------------------------------------------------- */

  const statsRef =
    db
      .collection("investmentStats")
      .doc("company");


  const statsSnap =
    await statsRef.get();


  const stats =
    statsSnap.exists
      ? statsSnap.data()
      : {};


  const totalRaised =
    Number(
      stats.totalRaised || 0
    );


  /* -------------------------------------------------------
     GET ALL COMPLETED EXPENSES
  ------------------------------------------------------- */

  const expensesSnap =
    await db
      .collection("expenses")
      .where(
        "status",
        "==",
        "COMPLETED"
      )
      .get();


  let totalExpenses = 0;


  expensesSnap.forEach(
    (doc) => {

      const expense =
        doc.data();


      totalExpenses +=
        Number(
          expense.amount || 0
        );

    }
  );


  /* -------------------------------------------------------
     CALCULATE ACTUAL BALANCE
  ------------------------------------------------------- */

  const actualBalance =
    totalRaised -
    totalExpenses;


  /* -------------------------------------------------------
     RETURN
  ------------------------------------------------------- */

  return {

    totalRaised,

    totalExpenses,

    actualBalance,

    expenseCount:
      expensesSnap.size,

  };

}


/* =========================================================
   GET EXPENSE HISTORY
========================================================= */

async function getCompanyExpenses() {

  const snapshot =
    await db
      .collection("expenses")
      .orderBy(
        "createdAt",
        "desc"
      )
      .get();


  const expenses = [];


  snapshot.forEach(
    (doc) => {

      expenses.push({

        id:
          doc.id,

        ...doc.data(),

      });

    }
  );


  return expenses;

}


/* =========================================================
   GET SINGLE EXPENSE
========================================================= */

async function getCompanyExpense(
  expenseId
) {

  if (!expenseId) {

    throw new Error(
      "Expense ID is required."
    );

  }


  const ref =
    db
      .collection("expenses")
      .doc(expenseId);


  const snap =
    await ref.get();


  if (!snap.exists) {

    throw new Error(
      "Expense not found."
    );

  }


  return {

    id:
      snap.id,

    ...snap.data(),

  };

}


/* =========================================================
   DELETE / VOID EXPENSE
========================================================= */

async function voidCompanyExpense({
  expenseId,
  adminId,
}) {

  if (!expenseId) {

    throw new Error(
      "Expense ID is required."
    );

  }


  const ref =
    db
      .collection("expenses")
      .doc(expenseId);


  const snap =
    await ref.get();


  if (!snap.exists) {

    throw new Error(
      "Expense not found."
    );

  }


  const expense =
    snap.data();


  if (
    expense.status ===
    "VOID"
  ) {

    throw new Error(
      "Expense has already been voided."
    );

  }


  await ref.update({

    status:
      "VOID",

    voidedBy:
      adminId || null,

    voidedAt:
      FieldValue.serverTimestamp(),

    updatedAt:
      FieldValue.serverTimestamp(),

  });


  return {

    success: true,

    expenseId,

    message:
      "Expense voided successfully.",

  };

}


/* =========================================================
   EXPORT
========================================================= */

module.exports = {

  addCompanyExpense,

  getActualCompanyPosition,

  getCompanyExpenses,

  getCompanyExpense,

  voidCompanyExpense,

};