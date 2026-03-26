const { Router } = require("express");
const { handlePaymentWebhook } = require("../services/bookingService");

const router = Router();

// POST /webhooks/payment
// Body: { paymentSessionID, status: 'paid' | 'failed' }
router.post("/payment", async (req, res, next) => {
  try {
    const { paymentSessionID, status } = req.body;
    if (!paymentSessionID || !status) {
      return res.status(400).json({ error: "paymentSessionID and status are required" });
    }

    await handlePaymentWebhook({ paymentSessionID, status });
    res.json({ received: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
