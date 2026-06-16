const express = require("express");
const router = express.Router();
const { approveWithdrawal } = require("../services/withdrawApproval");

/**
 * PRODUCTION WITHDRAW APPROVAL ROUTE
 * - Admin only
 * - Safe
 * - Auditable
 * - Idempotent-safe (handled in service too)
 */

// Example middleware (replace with your real auth)
function verifyAdmin(req, res, next) {
  const user = req.user; // assume JWT middleware sets this

  if (!user || user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Unauthorized: Admins only",
    });
  }

  next();
}

router.post("/approve", verifyAdmin, async (req, res) => {
  try {
    const { withdrawalId } = req.body;

    // 1. VALIDATION
    if (!withdrawalId) {
      return res.status(400).json({
        success: false,
        message: "withdrawalId is required",
      });
    }

    // 2. CALL BUSINESS LOGIC
    const result = await approveWithdrawal(withdrawalId);

    // 3. AUDIT LOG (optional but recommended)
    console.log("🟢 ADMIN APPROVED WITHDRAWAL:", {
      withdrawalId,
      adminId: req.user?.uid,
      timestamp: new Date().toISOString(),
    });

    return res.json(result);

  } catch (error) {
    console.error("❌ Approve withdrawal error:", error.message);

    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;