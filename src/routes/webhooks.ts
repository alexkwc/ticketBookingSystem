import { Router, Request, Response, NextFunction } from "express";
import { handlePaymentWebhook } from "../services/bookingService";

const router = Router();

// POST /webhooks/payment
// Body: { paymentSessionID, status: 'paid' | 'failed' }
router.post("/payment", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { paymentSessionID, status } = req.body as {
      paymentSessionID?: string;
      status?: string;
    };
    if (!paymentSessionID || !status) {
      return res.status(400).json({ error: "paymentSessionID and status are required" });
    }

    await handlePaymentWebhook({ paymentSessionID, status });
    res.json({ received: true });
  } catch (err) {
    next(err);
  }
});

export default router;
