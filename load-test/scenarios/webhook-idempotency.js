/**
 * Scenario: Webhook idempotency (first-write-wins)
 * Create 1 booking, complete payment via test helper (fires webhook).
 * Then manually POST the same webhook event two more times.
 * Booking should have exactly 1 success row — no duplicate processing.
 */
const { v4: uuidv4 } = require("uuid");
const fixtures = require("../fixtures");
const gen = require("../load-generator");
const verifier = require("../verifier");
const http = require("../http");
const config = require("../config");
const reporter = require("../reporter");

async function run(redis) {
  const { eventID, seatIDs } = await fixtures.createScenarioData(1, "webhook-idempotency");
  const seatID = seatIDs[0];
  const userID = uuidv4();

  // Create booking
  const bookingRes = await http.post(
    `${config.API_URL}/bookings`,
    { eventID, seatID },
    { "x-user-id": userID, "content-type": "application/json" }
  );

  if (bookingRes.status !== 201) {
    const checks = [
      {
        name: "Booking creation succeeded",
        result: { pass: false, detail: `Got HTTP ${bookingRes.status}` },
      },
    ];
    reporter.reportScenario("Webhook Idempotency", [bookingRes]);
    reporter.reportVerification(checks);
    return { eventID, passed: false, checks };
  }

  const sessionID = gen.extractSessionID(bookingRes.body.checkoutURL);

  // Complete via test helper — fires one webhook automatically (with random delay)
  await http.post(`${config.PAYMENT_URL}/test/complete/${sessionID}`);
  await gen.waitMs(6000); // wait for the test helper's random delay + webhook processing

  // Fire duplicate webhooks directly to the booking service
  const dup1 = await http.post(
    `${config.API_URL}/webhooks/payment`,
    { paymentSessionID: sessionID, status: "paid" },
    { "content-type": "application/json" }
  );
  const dup2 = await http.post(
    `${config.API_URL}/webhooks/payment`,
    { paymentSessionID: sessionID, status: "paid" },
    { "content-type": "application/json" }
  );

  const core = await verifier.runAll(redis, { eventID, seatIDs, checkSeatID: seatID });
  const checks = [...core.checks];

  checks.push({
    name: "Duplicate webhooks returned 200 (idempotent accept)",
    result:
      dup1.status === 200 && dup2.status === 200
        ? { pass: true, detail: "Both duplicates accepted without error" }
        : { pass: false, detail: `dup1=${dup1.status}, dup2=${dup2.status}` },
  });

  reporter.reportScenario("Webhook Idempotency — 1 booking + 2 duplicate webhooks", [bookingRes, dup1, dup2]);
  reporter.reportVerification(checks);

  const passed = checks.every((c) => c.result.pass);
  return { eventID, passed, checks };
}

module.exports = { run };
