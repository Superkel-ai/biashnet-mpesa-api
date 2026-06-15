const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

/**
 * SAFE FIREBASE INITIALIZATION (RAILWAY + PRODUCTION SAFE)
 */

let db;

// getApps() replaces the old admin.apps check
if (getApps().length === 0) {
  try {
    const serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
        : undefined,
    };

    if (
      !serviceAccount.projectId ||
      !serviceAccount.clientEmail ||
      !serviceAccount.privateKey
    ) {
      throw new Error("Missing Firebase environment variables");
    }

    // Call initializeApp and credential directly
    initializeApp({
      credential: cert(serviceAccount),
    });

    console.log("🔥 Firebase initialized successfully");
  } catch (error) {
    console.error("❌ Firebase initialization failed:", error.message);
    throw error;
  }
}

db = getFirestore();

// Export db and a compatibility object if other files expect 'admin'
module.exports = { db };