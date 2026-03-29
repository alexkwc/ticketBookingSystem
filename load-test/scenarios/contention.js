/**
 * Scenario: Seat lock correctness under contention
 * 30 users all try to book the same seat simultaneously.
 * Exactly 1 should succeed (201), 29 should get 409.
 */
const fixtures = require("../fixtures");
const gen = require("../load-generator");
const verifier = require("../verifier");
const http = require("../http");
const config = require("../config");
const reporter = require("../reporter");

const CONTENDERS = 30;

async function run(redis) {
  const { eventID, seatIDs } = await fixtures.createScenarioData(1, "contention");
  const seatID = seatIDs[0];

  const requests = gen.buildContestedRequests({ eventID, seatID, count: CONTENDERS });
  const results = await gen.runConcurrent(requests);

  const successes = results.filter((r) => r.status === 201);
  const conflicts = results.filter((r) => r.status === 409);

  // Complete the winner's payment
  if (successes.length === 1) {
    const sessionID = gen.extractSessionID(successes[0].body.checkoutURL);
    if (sessionID) {
      await http.post(`${config.PAYMENT_URL}/test/complete/${sessionID}`);
    }
  }
  await gen.waitMs(6000); // mock payment fires webhook after up to 5 s

  const core = await verifier.runAll(redis, { eventID, seatIDs, checkSeatID: seatID });
  const checks = [...core.checks];

  checks.push({
    name: "Exactly 1 booking returned 201",
    result:
      successes.length === 1
        ? { pass: true, detail: "1 winner" }
        : { pass: false, detail: `Got ${successes.length} successes` },
  });
  checks.push({
    name: `${CONTENDERS - 1} bookings returned 409`,
    result:
      conflicts.length === CONTENDERS - 1
        ? { pass: true, detail: `${conflicts.length} conflicts` }
        : { pass: false, detail: `Got ${conflicts.length} conflicts, expected ${CONTENDERS - 1}` },
  });

  reporter.reportScenario(`Contention — ${CONTENDERS} users, 1 seat`, results);
  reporter.reportVerification(checks);

  const passed = checks.every((c) => c.result.pass);
  return { eventID, passed, checks };
}

module.exports = { run };
