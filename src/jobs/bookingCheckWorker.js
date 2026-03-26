require("dotenv").config();
const { Worker } = require("bullmq");
const { Redis } = require("ioredis");
const { pool } = require("../config/db");
const { getPaymentStatus } = require("../services/paymentClient");
const { confirmBookingSuccess } = require("../services/bookingService");

const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker(
  "booking-check",
  async (job) => {
    const { bookingID } = job.data;

    const { rows } = await pool.query(
      `SELECT * FROM bookings WHERE id = $1`,
      [bookingID]
    );

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

worker.on("failed", (job, err) => {
  console.error(`booking-check job ${job?.id} failed:`, err.message);
});

console.log("Booking check worker started");
