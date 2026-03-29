const { Queue } = require("bullmq");
const { redis } = require("../config/redis");

// BullMQ requires a dedicated connection (no shared subscriber)
const { Redis } = require("ioredis");
const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

const bookingCheckQueue = new Queue("booking-check", { connection });

/**
 * Enqueue a job that fires after `delayMs` milliseconds.
 * The job will poll the payment service and confirm/reject the booking.
 */
async function enqueueBookingCheck(bookingID, delayMs) {
  await bookingCheckQueue.add(
    "check",
    { bookingID },
    {
      delay: delayMs,
      jobId: `booking-check-${bookingID}`, // deduplication
      removeOnComplete: true,
      removeOnFail: 1000,
    }
  );
}

module.exports = { bookingCheckQueue, enqueueBookingCheck };
