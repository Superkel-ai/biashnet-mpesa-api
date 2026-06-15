const admin = require("firebase-admin");

/**
 * SAFE FIREBASE INITIALIZATION (RAILWAY + PRODUCTION SAFE)
 */

if (!admin.apps || admin.apps.length === 0) {
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

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    console.log("🔥 Firebase initialized successfully");
  } catch (error) {
    console.error("❌ Firebase initialization failed:", error.message);
    throw error;
  }
}

const db = admin.firestore();

module.exports = { admin, db };