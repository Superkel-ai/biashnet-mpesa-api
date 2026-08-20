const admin = require("firebase-admin");
const {
  getApps,
  cert,
} = require("firebase-admin/app");

const {
  getFirestore,
  FieldValue,
} = require("firebase-admin/firestore");


/*
=========================================================
FIREBASE ADMIN INITIALIZATION
=========================================================
*/

if (getApps().length === 0) {

  try {

    let rawKey =
      process.env.FIREBASE_PRIVATE_KEY;


    /*
    -------------------------------------------------------
    NORMALIZE PRIVATE KEY
    -------------------------------------------------------
    */

    if (rawKey) {

      // Remove accidental surrounding quotes
      rawKey =
        rawKey
          .trim()
          .replace(/^["']|["']$/g, "");


      // Convert literal \n into real newlines
      rawKey =
        rawKey.replace(/\\n/g, "\n");


      // Normalize Windows line endings
      rawKey =
        rawKey.replace(/\r\n/g, "\n");

    }


    /*
    -------------------------------------------------------
    SERVICE ACCOUNT
    -------------------------------------------------------
    */

    const serviceAccount = {

      projectId:
        process.env.FIREBASE_PROJECT_ID,

      clientEmail:
        process.env.FIREBASE_CLIENT_EMAIL,

      privateKey:
        rawKey,

    };


    /*
    -------------------------------------------------------
    VALIDATE ENVIRONMENT
    -------------------------------------------------------
    */

    if (
      !serviceAccount.projectId ||
      !serviceAccount.clientEmail ||
      !serviceAccount.privateKey
    ) {

      throw new Error(
        "Missing Firebase environment variables."
      );

    }


    /*
    -------------------------------------------------------
    INITIALIZE FIREBASE ADMIN
    -------------------------------------------------------
    */

    admin.initializeApp({

      credential:
        cert(serviceAccount),

    });


    console.log(
      "🔥 Firebase Admin initialized successfully"
    );


  } catch (error) {

    console.error(
      "❌ Firebase initialization failed:",
      error.message
    );

    throw error;

  }

}


/*
=========================================================
FIRESTORE
=========================================================
*/

const db =
  getFirestore();


/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

  admin,

  db,

  FieldValue,

};