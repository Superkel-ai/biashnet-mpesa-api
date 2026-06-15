const express = require("express");
const cors = require("cors");
require("dotenv").config();

const stkRoutes = require("./routes/stk");

const app = express();

/* =====================================================
   CONFIG
===================================================== */

app.set("trust proxy", true);

/* =====================================================
   MIDDLEWARE
===================================================== */

app.use(cors());

app.use(
  express.json({
    limit: "10mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
  })
);

/* =====================================================
   HEALTH CHECK
===================================================== */

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    app: "Biashnet M-Pesa API",
    status: "LIVE",
    environment:
      process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
  });
});

/* =====================================================
   API ROUTES
===================================================== */

app.use("/api", stkRoutes);

/* =====================================================
   MPESA CALLBACK
===================================================== */

app.post("/callback", async (req, res) => {
  try {
    console.log(
      "=============================="
    );
    console.log(
      "📩 MPESA CALLBACK RECEIVED"
    );
    console.log(
      JSON.stringify(
        req.body,
        null,
        2
      )
    );
    console.log(
      "=============================="
    );

    // TODO:
    // Save transaction
    // Update Firestore
    // Credit wallet
    // Update order

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Accepted",
    });

  } catch (error) {

    console.error(
      "🔥 Callback Error:",
      error
    );

    return res.status(500).json({
      ResultCode: 1,
      ResultDesc: "Failed",
    });

  }
});

/* =====================================================
   404 HANDLER
===================================================== */

app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

/* =====================================================
   ERROR HANDLER
===================================================== */

app.use(
  (err, req, res, next) => {

    console.error(
      "🔥 Server Error:",
      err
    );

    res.status(500).json({
      success: false,
      message:
        err.message ||
        "Internal Server Error",
    });

  }
);

/* =====================================================
   START SERVER
===================================================== */

const PORT =
  process.env.PORT || 3000;

const server = app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "================================"
    );

    console.log(
      `🚀 Biashnet API Running`
    );

    console.log(
      `🌍 Port: ${PORT}`
    );

    console.log(
      `📦 Environment: ${
        process.env.NODE_ENV ||
        "development"
      }`
    );

    console.log(
      "================================"
    );

  }
);

/* =====================================================
   GRACEFUL SHUTDOWN
===================================================== */

process.on(
  "SIGTERM",
  () => {

    console.log(
      "⚠️ SIGTERM received"
    );

    server.close(() => {

      console.log(
        "🛑 Server closed"
      );

      process.exit(0);

    });

  }
);

process.on(
  "unhandledRejection",
  (reason) => {

    console.error(
      "🔥 Unhandled Rejection:",
      reason
    );

  }
);

process.on(
  "uncaughtException",
  (error) => {

    console.error(
      "🔥 Uncaught Exception:",
      error
    );

  }
);