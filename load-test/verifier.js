const db = require("./db");
const config = require("./config");

function pass(detail) {
  return { pass: true, detail };
}

function fail(detail) {
  return { pass: false, detail };
}

/**
 * Invariant 1: No seat should have more than one success booking.
 */
async function noDoubleBookings(eventID) {
  const rows = await db.query(
    `SELECT seat_id, COUNT(*) AS cnt
     FROM bookings
     WHERE event_id = $1 AND status = 'success'
     GROUP BY seat_id
     HAVING COUNT(*) > 1`,
    [eventID]
  );
  if (rows.length === 0) return pass("No double bookings found");
  return fail(`Double bookings on ${rows.length} seat(s): ${rows.map((r) => r.seat_id).join(", ")}`);
}

/**
 * Invariant 2: A specific seat should have exactly 1 success booking.
 */
async function exactlyOneSuccess(eventID, seatID) {
  const rows = await db.query(
    `SELECT id FROM bookings WHERE event_id = $1 AND seat_id = $2 AND status = 'success'`,
    [eventID, seatID]
  );
  if (rows.length === 1) return pass(`Exactly 1 success for seat ${seatID}`);
  return fail(`Expected 1 success for seat ${seatID}, got ${rows.length}`);
}

/**
 * Invariant 3: No booking should have status='rejected' in DB (it's derived only).
 */
async function noRejectedInDB(eventID) {
  const rows = await db.query(
    `SELECT COUNT(*) AS cnt FROM bookings
     WHERE event_id = $1 AND status NOT IN ('pending', 'success')`,
    [eventID]
  );
  const count = parseInt(rows[0].cnt);
  if (count === 0) return pass("No explicitly-stored rejected status found");
  return fail(`Found ${count} booking(s) with invalid status in DB`);
}

/**
 * Invariant 4: All outbox entries for this event's bookings are eventually processed.
 * Polls until processed or times out.
 */
async function outboxComplete(eventID, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await db.query(
      `SELECT id FROM outbox
       WHERE processed_at IS NULL
       AND payload->>'bookingID' IN (
         SELECT id::text FROM bookings WHERE event_id = $1
       )`,
      [eventID]
    );
    if (rows.length === 0) return pass("All outbox entries processed");
    await new Promise((r) => setTimeout(r, 1000));
  }
  const remaining = await db.query(
    `SELECT id FROM outbox
     WHERE processed_at IS NULL
     AND payload->>'bookingID' IN (
       SELECT id FROM bookings WHERE event_id = $1
     )`,
    [eventID]
  );
  return fail(`${remaining.length} outbox entry(ies) still unprocessed after ${timeoutMs}ms`);
}

/**
 * Invariant 5: Every pending booking that lost its seat to a success booking
 * must have a refund entry in the outbox.
 */
async function refundCompleteness(eventID) {
  // Find pending bookings that should have triggered a refund
  const displaced = await db.query(
    `SELECT b.id, b.payment_session_id FROM bookings b
     WHERE b.event_id = $1
       AND b.status = 'pending'
       AND b.payment_session_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM bookings b2
         WHERE b2.event_id = b.event_id
           AND b2.seat_id = b.seat_id
           AND b2.status = 'success'
           AND b2.id != b.id
       )`,
    [eventID]
  );

  if (displaced.length === 0) return pass("No displaced bookings requiring refunds");

  const missing = [];
  for (const booking of displaced) {
    const outboxEntry = await db.queryOne(
      `SELECT id FROM outbox WHERE payload->>'bookingID' = $1 AND type = 'refund'`,
      [booking.id]
    );
    if (!outboxEntry) missing.push(booking.id);
  }

  if (missing.length === 0)
    return pass(`All ${displaced.length} displaced booking(s) have outbox refund entries`);
  return fail(`${missing.length}/${displaced.length} displaced booking(s) missing outbox refund entry`);
}

/**
 * Invariant 6: Every pending (non-expired) booking should have a Redis lock.
 */
async function lockConsistency(redis, eventID, seatIDs) {
  const pendingRows = await db.query(
    `SELECT seat_id FROM bookings
     WHERE event_id = $1
       AND status = 'pending'
       AND created_at + ($2 || ' minutes')::interval > now()`,
    [eventID, config.BOOKING_WINDOW_MINUTES]
  );

  const inconsistencies = [];
  for (const row of pendingRows) {
    const lockKey = `lock:${eventID}:${row.seat_id}`;
    const exists = await redis.exists(lockKey);
    if (!exists) inconsistencies.push(row.seat_id);
  }

  if (inconsistencies.length === 0)
    return pass("All pending bookings have corresponding Redis locks");
  return fail(
    `${inconsistencies.length} pending booking(s) missing Redis lock: ${inconsistencies.join(", ")}`
  );
}

/**
 * Run all applicable invariant checks and return a summary.
 */
async function runAll(redis, { eventID, seatIDs = [], checkSeatID = null }) {
  const checks = [];

  checks.push({ name: "No double bookings", result: await noDoubleBookings(eventID) });
  checks.push({ name: "No rejected status in DB", result: await noRejectedInDB(eventID) });
  checks.push({ name: "Lock consistency", result: await lockConsistency(redis, eventID, seatIDs) });

  if (checkSeatID) {
    checks.push({ name: "Exactly one success", result: await exactlyOneSuccess(eventID, checkSeatID) });
  }

  const passed = checks.filter((c) => c.result.pass).length;
  const failed = checks.filter((c) => !c.result.pass).length;

  return { passed, failed, checks };
}

module.exports = {
  noDoubleBookings,
  exactlyOneSuccess,
  noRejectedInDB,
  outboxComplete,
  refundCompleteness,
  lockConsistency,
  runAll,
};
