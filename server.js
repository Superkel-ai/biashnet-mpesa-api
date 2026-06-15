const express = require("express");
const cors = require("cors");
require("dotenv").config();

const stkRoutes = require("./routes/stk");

const app = express();

/* =========================================
   MIDDLEWARE
========================================= */

app.use(cors());

app.use(express.json());

app.use(express.urlencoded({
  extended: true,
}));

/* =========================================
   HEALTH CHECK
========================================= */

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

/* =========================================
   API ROUTES
========================================= */

app.use("/api", stkRoutes);

/* =========================================
   MPESA CALLBACK
========================================= */

app.post("/callback", (req, res) => {

  console.log("📩 MPESA CALLBACK");

  console.log(
    JSON.stringify(
      req.body,
      null,
      2
    )
  );

  return res.status(200).json({
    ResultCode: 0,
    ResultDesc: "Accepted",
  });

});

/* =========================================
   ERROR HANDLER
========================================= */

app.use((err, req, res, next) => {

  console.error(err);

  res.status(500).json({
    success: false,
    message:
      err.message ||
      "Internal Server Error",
  });

});

/* =========================================
   START SERVER
========================================= */

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(
    `🚀 Biashnet API running on port ${PORT}`
  );

});