import { v4 as uuidv4 } from "uuid";
import { pool } from "../config/db";
import { acquireLock } from "./lockService";
import { createPaymentSession, getPaymentStatus } from "./paymentClient";
import { enqueueBookingCheck } from "../jobs/bookingCheckQueue";
import type { Booking, DerivedBookingStatus } from "../types";

const BOOKING_WINDOW = parseInt(process.env.BOOKING_WINDOW_MINUTES ?? "30");

/**
 * Derive the effective status of a booking row.
 * 'rejected' is never stored — it is derived at read time.
 */
function deriveStatus(booking: Booking): DerivedBookingStatus {
  if (booking.status === "success") return "success";
  const expiredAt = new Date(booking.created_at);
  expiredAt.setMinutes(expiredAt.getMinutes() + BOOKING_WINDOW);
  return expiredAt < new Date() ? "rejected" : "pending";
}

/**
 * POST /bookings handler.
 * 1. Acquire Redis lock
 * 2. Insert booking row (idempotency: unique on event+seat+user)
 * 3. Call payment service to create session
 * 4. Enqueue delayed job at minute 30
 */
async function createBooking(params: {
  eventID: string;
  seatID: string;
  userID: string;
}): Promise<{ bookingID: string; status: string; checkoutURL: string }> {
  const { eventID, seatID, userID } = params;

  // 1. Try to acquire the Redis lock
  const lockToken = uuidv4();
  const acquired = await acquireLock(eventID, seatID, lockToken);
  if (!acquired) {
    throw Object.assign(new Error("Seat is already locked by another booking"), { status: 409 });
  }

  // 2. Insert booking (idempotency key: event_id + seat_id + user_id)
  const { rows } = await pool.query<Booking>(
    `INSERT INTO bookings (id, event_id, seat_id, user_id, status)
     VALUES ($1, $2, $3, $4, 'pending')
     ON CONFLICT (event_id, seat_id, user_id) DO UPDATE SET id = EXCLUDED.id
     RETURNING *`,
    [uuidv4(), eventID, seatID, userID]
  );
  let booking = rows[0];

  // 3. Create payment session — if unreachable, surface error to user
  let paymentSession;
  try {
    paymentSession = await createPaymentSession({
      bookingID: booking.id,
      userID,
      amount: 1000, // cents; real system would look up event price
    });
  } catch {
    throw Object.assign(
      new Error("Payment service is currently unavailable. Please try again later."),
      { status: 503 }
    );
  }

  // Store paymentSessionID on the booking
  const { rows: updated } = await pool.query<Booking>(
    `UPDATE bookings SET payment_session_id = $1 WHERE id = $2 RETURNING *`,
    [paymentSession.sessionID, booking.id]
  );
  booking = updated[0];

  // 4. Enqueue delayed job to fire at minute 30
  await enqueueBookingCheck(booking.id, BOOKING_WINDOW * 60 * 1000);

  return {
    bookingID: booking.id,
    status: "pending",
    checkoutURL: paymentSession.checkoutURL,
  };
}

/**
 * Webhook handler — idempotent using paymentSessionID as key.
 * Step 6: check status then update booking.
 */
async function handlePaymentWebhook(params: {
  paymentSessionID: string;
  status: string;
}): Promise<void> {
  const { paymentSessionID } = params;

  const { rows } = await pool.query<Booking>(
    `SELECT * FROM bookings WHERE payment_session_id = $1`,
    [paymentSessionID]
  );
  if (!rows.length) return; // unknown session — ignore

  const booking = rows[0];

  // Idempotency: if already success, skip
  if (booking.status === "success") return;

  // Step 6.1.1: verify status with payment service before trusting webhook
  let verified;
  try {
    verified = await getPaymentStatus(paymentSessionID);
  } catch {
    // Payment service unreachable — let the minute-30 job handle it
    return;
  }

  if (verified.status !== "paid") return; // not paid yet

  await confirmBookingSuccess(booking);
}

/**
 * Called by both the webhook handler and the minute-30 job.
 * Atomically confirms the booking as success, or triggers a refund if seat was re-booked.
 * Step 7 of the payment flow.
 */
async function confirmBookingSuccess(booking: Booking): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Step 7.1: check for a newer booking on the same event+seat
    const { rows: conflicts } = await client.query<{ id: string }>(
      `SELECT id FROM bookings
       WHERE event_id = $1 AND seat_id = $2 AND id != $3 AND created_at > $4
       ORDER BY created_at ASC
       LIMIT 1`,
      [booking.event_id, booking.seat_id, booking.id, booking.created_at]
    );

    if (conflicts.length > 0) {
      // Step 7.2: conflict — refund this booking via outbox
      await client.query(
        `INSERT INTO outbox (id, type, payload) VALUES ($1, 'refund', $2)`,
        [
          uuidv4(),
          JSON.stringify({
            paymentSessionID: booking.payment_session_id,
            bookingID: booking.id,
          }),
        ]
      );
    } else {
      // Step 7.3: no conflict — mark success
      await client.query(`UPDATE bookings SET status = 'success' WHERE id = $1`, [booking.id]);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export { createBooking, handlePaymentWebhook, confirmBookingSuccess, deriveStatus };
