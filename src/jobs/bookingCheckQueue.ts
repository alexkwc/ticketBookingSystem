import { Queue } from "bullmq";
import Redis from "ioredis";

// BullMQ requires a dedicated connection (no shared subscriber)
const connection = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: null });

const bookingCheckQueue = new Queue("booking-check", { connection });

/**
 * Enqueue a job that fires after `delayMs` milliseconds.
 * The job will poll the payment service and confirm/reject the booking.
 */
async function enqueueBookingCheck(bookingID: string, delayMs: number): Promise<void> {
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

export { bookingCheckQueue, enqueueBookingCheck };
