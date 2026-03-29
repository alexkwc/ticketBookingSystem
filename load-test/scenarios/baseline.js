/**
 * Scenario: Happy-path concurrency
 * 50 users each booking a different seat simultaneously.
 * All should succeed, outbox should be empty, no double bookings.
 */
const { v4: uuidv4 } = require("uuid");
const fixtures = require("../fixtures");
const gen = require("../load-generator");
const verifier = require("../verifier");
const http = require("../http");
const config = require("../config");
const reporter = require("../reporter");

const SEAT_COUNT = 50;

async function run(redis) {
  const { eventID, seatIDs } = await fixtures.createScenarioData(SEAT_COUNT, "baseline");
  const userIDs = Array.from({ length: SEAT_COUNT }, () => uuidv4());

  const requests = gen.buildBookingRequests({ eventID, seatIDs, userIDs });
  const results = await gen.runConcurrent(requests);

  // Complete payment for all successful bookings
  for (const r of results.filter((r) => r.status === 201)) {
    const sessionID = gen.extractSessionID(r.body.checkoutURL);
    if (sessionID) {
      await http.post(`${config.PAYMENT_URL}/test/complete/${sessionID}`);
    }
  }

  // Wait for webhooks and outbox worker
  await gen.waitMs(5000);

  const core = await verifier.runAll(redis, { eventID, seatIDs });
  const outbox = await verifier.outboxComplete(eventID);
  const checks = [...core.checks, { name: "Outbox complete", result: outbox }];

  // Additional check: all 50 requests got 201
  const allSucceeded = results.filter((r) => r.status === 201).length === SEAT_COUNT;
  checks.push({
    name: `All ${SEAT_COUNT} bookings returned 201`,
    result: allSucceeded
      ? { pass: true, detail: `All ${SEAT_COUNT} succeeded` }
      : { pass: false, detail: `Only ${results.filter((r) => r.status === 201).length}/${SEAT_COUNT} got 201` },
  });

  reporter.reportScenario("Baseline — 50 users, 50 seats", results);
  reporter.reportVerification(checks);

  const passed = checks.every((c) => c.result.pass);
  return { eventID, passed, checks };
}

module.exports = { run };
