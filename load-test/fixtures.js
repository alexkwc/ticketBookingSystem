const { v4: uuidv4 } = require("uuid");
const db = require("./db");

async function setup() {
  // Clean up any orphaned test data from interrupted previous runs
  const rows = await db.query(
    `SELECT id, venue_id FROM events WHERE name LIKE 'load-test-%'`
  );
  for (const row of rows) {
    await cleanupScenario(row.id);
  }
}

async function createScenarioData(seatCount, label) {
  const venueID = uuidv4();
  const eventID = uuidv4();

  await db.query(
    `INSERT INTO venues (id, name, address) VALUES ($1, $2, $3)`,
    [venueID, `load-test-venue-${uuidv4()}`, "Test Address"]
  );

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  await db.query(
    `INSERT INTO events (id, name, host, date, venue_id) VALUES ($1, $2, $3, $4, $5)`,
    [eventID, `load-test-${label}-${uuidv4()}`, "load-test", tomorrow, venueID]
  );

  const seatIDs = [];
  for (let i = 1; i <= seatCount; i++) {
    const seatID = uuidv4();
    await db.query(
      `INSERT INTO seats (id, venue_id, label) VALUES ($1, $2, $3)`,
      [seatID, venueID, `T${i}`]
    );
    seatIDs.push(seatID);
  }

  return { venueID, eventID, seatIDs };
}

async function cleanupScenario(eventID) {
  // Delete outbox entries for this event's bookings
  await db.query(
    `DELETE FROM outbox WHERE payload->>'bookingID' IN (
      SELECT id::text FROM bookings WHERE event_id = $1
    )`,
    [eventID]
  );

  // Delete bookings
  await db.query(`DELETE FROM bookings WHERE event_id = $1`, [eventID]);

  // Get venue_id before deleting event
  const event = await db.queryOne(
    `SELECT venue_id FROM events WHERE id = $1`,
    [eventID]
  );

  // Delete event
  await db.query(`DELETE FROM events WHERE id = $1`, [eventID]);

  if (event) {
    // Delete seats and venue
    await db.query(`DELETE FROM seats WHERE venue_id = $1`, [event.venue_id]);
    await db.query(`DELETE FROM venues WHERE id = $1`, [event.venue_id]);
  }
}

async function teardown() {
  await setup(); // re-runs cleanup pass
}

module.exports = { setup, createScenarioData, cleanupScenario, teardown };
