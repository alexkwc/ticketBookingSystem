/**
 * Scenario: Happy-path concurrency
 * 50 users each booking a different seat simultaneously.
 * All should succeed, outbox should be empty, no double bookings.
 */
import { v4 as uuidv4 } from "uuid";
import type Redis from "ioredis";
import * as fixtures from "../fixtures";
import * as gen from "../load-generator";
import * as verifier from "../verifier";
import * as http from "../http";
import { PAYMENT_URL } from "../config";
import * as reporter from "../reporter";
import type { Check } from "../reporter";

const SEAT_COUNT = 50;

async function run(redis: Redis): Promise<{ eventID: string; passed: boolean }> {
  const { eventID, seatIDs } = await fixtures.createScenarioData(SEAT_COUNT, "baseline");
  const userIDs = Array.from({ length: SEAT_COUNT }, () => uuidv4());

  const requests = gen.buildBookingRequests({ eventID, seatIDs, userIDs });
  const results = await gen.runConcurrent(requests);

  // Complete payment for all successful bookings
  for (const r of results.filter((r) => r.status === 201)) {
    const sessionID = gen.extractSessionID((r.body as { checkoutURL?: string }).checkoutURL);
    if (sessionID) {
      await http.post(`${PAYMENT_URL}/test/complete/${sessionID}`);
    }
  }

  // Wait for webhooks and outbox worker
  await gen.waitMs(5000);

  const core = await verifier.runAll(redis, { eventID, seatIDs });
  const outbox = await verifier.outboxComplete(eventID);
  const checks: Check[] = [...core.checks, { name: "Outbox complete", result: outbox }];

  // Additional check: all 50 requests got 201
  const got201 = results.filter((r) => r.status === 201).length;
  checks.push({
    name: `All ${SEAT_COUNT} bookings returned 201`,
    result:
      got201 === SEAT_COUNT
        ? { pass: true, detail: `All ${SEAT_COUNT} succeeded` }
        : { pass: false, detail: `Only ${got201}/${SEAT_COUNT} got 201` },
  });

  reporter.reportScenario("Baseline — 50 users, 50 seats", results);
  reporter.reportVerification(checks);

  const passed = checks.every((c) => c.result.pass);
  return { eventID, passed };
}

export { run };
