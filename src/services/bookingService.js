const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/db");
const { acquireLock } = require("./lockService");
const { createPaymentSession, getPaymentStatus } = require("./paymentClient");
const { enqueueBookingCheck } = require("../jobs/bookingCheckQueue");

const BOOKING_WINDOW = parseInt(process.env.BOOKING_WINDOW_MINUTES || 30);

/**
 * Derive the effective status of a booking row.
 * 'rejected' is never stored — it is derived at read time.
 */
function deriveStatus(booking) {
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
async function createBooking({ eventID, seatID, userID }) {
  // 1. Try to acquire the Redis lock
  const lockToken = uuidv4();
  const acquired = await acquireLock(eventID, seatID, lockToken);
  if (!acquired) {
    throw Object.assign(new Error("Seat is already locked by another booking"), { status: 409 });
  }

  // 2. Insert booking (idempotency key: event_id + seat_id + user_id)
  let booking;
  try {
    const { rows } = await pool.query(
      `INSERT INTO bookings (id, event_id, seat_id, user_id, status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT (event_id, seat_id, user_id) DO UPDATE SET id = EXCLUDED.id
       RETURNING *`,
      [uuidv4(), eventID, seatID, userID]
    );
    booking = rows[0];
  } catch (err) {
    throw err;
  }

  // 3. Create payment session — if unreachable, mark as rejected immediately
  let paymentSession;
  try {
    paymentSession = await createPaymentSession({
      bookingID: booking.id,
      userID,
      amount: 1000, // cents; real system would look up event price
    });
  } catch (err) {
    // Payment service down — booking stays pending but will expire; surface error to user
    const error = Object.assign(
      new Error("Payment service is currently unavailable. Please try again later."),
      { status: 503 }
    );
    throw error;
  }

  // Store paymentSessionID on the booking
  const { rows: updated } = await pool.query(
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
async function handlePaymentWebhook({ paymentSessionID, status }) {
  // Find booking by payment session ID
  const { rows } = await pool.query(
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
async function confirmBookingSuccess(booking) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Step 7.1: check for a newer booking on the same event+seat
    const { rows: conflicts } = await client.query(
      `SELECT id FROM bookings
       WHERE event_id = $1 AND seat_id = $2 AND id != $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [booking.event_id, booking.seat_id, booking.id]
    );

    if (conflicts.length > 0) {
      // Step 7.2: conflict — refund this booking via outbox
      await client.query(
        `INSERT INTO outbox (id, type, payload)
         VALUES ($1, 'refund', $2)`,
        [uuidv4(), JSON.stringify({ paymentSessionID: booking.payment_session_id, bookingID: booking.id })]
      );
    } else {
      // Step 7.3: no conflict — mark success
      await client.query(
        `UPDATE bookings SET status = 'success' WHERE id = $1`,
        [booking.id]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createBooking, handlePaymentWebhook, confirmBookingSuccess, deriveStatus };
