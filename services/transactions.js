const { db } = require("../config/firebase");

// prevent duplicate + save transaction
async function saveTransaction(data) {
  const ref = db.collection("transactions").doc(data.checkoutRequestID);

  const exists = await ref.get();

  if (exists.exists) return false;

  await ref.set({
    ...data,
    createdAt: new Date(),
  });

  return true;
}

module.exports = { saveTransaction };