import "dotenv/config";
import { Worker, Job } from "bullmq";
import Redis from "ioredis";
import { pool } from "../config/db";
import { getPaymentStatus } from "../services/paymentClient";
import { confirmBookingSuccess } from "../services/bookingService";
import type { Booking } from "../types";

const connection = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: null });

const worker = new Worker<{ bookingID: string }>(
  "booking-check",
  async (job: Job<{ bookingID: string }>) => {
    const { bookingID } = job.data;

    const { rows } = await pool.query<Booking>(`SELECT * FROM bookings WHERE id = $1`, [bookingID]);

    if (!rows.length) return; // booking deleted
    const booking = rows[0];
    if (booking.status === "success") return; // already confirmed

    if (!booking.payment_session_id) {
      // Payment session was never created — booking will be derived as 'rejected' by callers
      return;
    }

    // Poll payment service
    let paymentResult;
    try {
      paymentResult = await getPaymentStatus(booking.payment_session_id);
    } catch {
      // Payment service down — job will be retried by BullMQ
      throw new Error("Payment service unreachable; will retry");
    }

    if (paymentResult.status === "paid") {
      await confirmBookingSuccess(booking);
    }
    // If 'pending' or 'failed' — booking expires naturally (derived rejected status)
  },
  { connection, concurrency: 5 }
);

worker.on("failed", (job: Job | undefined, err: Error) => {
  console.error(`booking-check job ${job?.id} failed:`, err.message);
});

console.log("Booking check worker started");
