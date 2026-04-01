/**
 * Scenario: Seat lock correctness under contention
 * 30 users all try to book the same seat simultaneously.
 * Exactly 1 should succeed (201), 29 should get 409.
 */
import type Redis from "ioredis";
import * as fixtures from "../fixtures";
import * as gen from "../load-generator";
import * as verifier from "../verifier";
import * as http from "../http";
import { PAYMENT_URL } from "../config";
import * as reporter from "../reporter";
import type { Check } from "../reporter";

const CONTENDERS = 30;

async function run(redis: Redis): Promise<{ eventID: string; passed: boolean }> {
  const { eventID, seatIDs } = await fixtures.createScenarioData(1, "contention");
  const seatID = seatIDs[0];

  const requests = gen.buildContestedRequests({ eventID, seatID, count: CONTENDERS });
  const results = await gen.runConcurrent(requests);

  const successes = results.filter((r) => r.status === 201);
  const conflicts = results.filter((r) => r.status === 409);

  // Complete the winner's payment
  if (successes.length === 1) {
    const sessionID = gen.extractSessionID(
      (successes[0].body as { checkoutURL?: string }).checkoutURL
    );
    if (sessionID) {
      await http.post(`${PAYMENT_URL}/test/complete/${sessionID}`);
    }
  }
  await gen.waitMs(6000); // mock payment fires webhook after up to 5s

  const core = await verifier.runAll(redis, { eventID, seatIDs, checkSeatID: seatID });
  const checks: Check[] = [...core.checks];

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
        : {
            pass: false,
            detail: `Got ${conflicts.length} conflicts, expected ${CONTENDERS - 1}`,
          },
  });

  reporter.reportScenario(`Contention — ${CONTENDERS} users, 1 seat`, results);
  reporter.reportVerification(checks);

  const passed = checks.every((c) => c.result.pass);
  return { eventID, passed };
}

export { run };
