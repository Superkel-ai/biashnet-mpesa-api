const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

/**
 * SAFE FIREBASE INITIALIZATION (RAILWAY + PRODUCTION SAFE)
 */

let db;

if (getApps().length === 0) {
  try {
    let rawKey = process.env.FIREBASE_PRIVATE_KEY;

    if (rawKey) {
      // 1. Remove stray enclosing quotes if added by copy-pasting
      rawKey = rawKey.trim().replace(/^["']|["']$/g, '');
      
      // 2. Safely parse both literal '\n' text strings and raw physical linebreaks
      if (rawKey.includes('\\n')) {
        rawKey = rawKey.replace(/\\n/g, '\n');
      } else {
        rawKey = rawKey.replace(/\r\n/g, '\n');
      }
    }

    const serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: rawKey,
    };

    if (
      !serviceAccount.projectId ||
      !serviceAccount.clientEmail ||
      !serviceAccount.privateKey
    ) {
      throw new Error("Missing Firebase environment variables");
    }

    // Initialize with the normalized service account credentials
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

module.exports = { db };