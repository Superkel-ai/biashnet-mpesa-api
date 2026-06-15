const { db } = require("../config/firebase");

// create or update wallet
async function creditWallet(phone, amount) {
  const ref = db.collection("wallets").doc(phone);

  const doc = await ref.get();

  if (!doc.exists) {
    await ref.set({
      phone,
      balance: amount,
      updatedAt: new Date(),
    });
  } else {
    const current = doc.data().balance || 0;

    await ref.update({
      balance: current + amount,
      updatedAt: new Date(),
    });
  }
}

module.exports = { creditWallet };