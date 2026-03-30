/**
 * Scenario: Full chaos mix — slow payment + seat contention
 * 5 users compete for each of 3 seats (15 concurrent requests total).
 * Payment service is slow during the burst, increasing the contention window.
 * Exactly 3 bookings should succeed (one per seat).
 * All displaced bookings that paid must get outbox refund entries.
 */
import { v4 as uuidv4 } from "uuid";
import type Redis from "ioredis";
import * as fixtures from "../fixtures";
import * as gen from "../load-generator";
import * as verifier from "../verifier";
import * as chaos from "../chaos";
import * as http from "../http";
import { API_URL, PAYMENT_URL } from "../config";
import * as reporter from "../reporter";
import type { BookingRequest } from "../load-generator";
import type { Check } from "../reporter";

const SEATS = 3;
const USERS_PER_SEAT = 5;

async function run(redis: Redis): Promise<{ eventID: string; passed: boolean }> {
  const { eventID, seatIDs } = await fixtures.createScenarioData(SEATS, "chaos-mix");

  // Build 15 requests: 5 per seat
  const allRequests: BookingRequest[] = [];
  for (const seatID of seatIDs) {
    for (let i = 0; i < USERS_PER_SEAT; i++) {
      allRequests.push({
        id: `${seatID}-${i}`,
        url: `${API_URL}/bookings`,
        headers: { "x-user-id": uuidv4(), "content-type": "application/json" },
        body: { eventID, seatID },
      });
    }
  }

  // Fire under slow chaos
  await chaos.setChaosMode("slow");
  const results = await gen.runConcurrent(allRequests);
  await chaos.setChaosMode("reset");

  // Complete payment for all winners (201 responses)
  for (const r of results.filter((r) => r.status === 201)) {
    const sessionID = gen.extractSessionID((r.body as { checkoutURL?: string }).checkoutURL);
    if (sessionID) {
      await http.post(`${PAYMENT_URL}/test/complete/${sessionID}`);
    }
  }

  // Wait for webhooks + outbox worker (outbox polls every 5s, allow 3 cycles)
  await gen.waitMs(20000);

  const core = await verifier.runAll(redis, { eventID, seatIDs });
  const outbox = await verifier.outboxComplete(eventID, 5000); // should already be done
  const refunds = await verifier.refundCompleteness(eventID);

  const checks: Check[] = [
    ...core.checks,
    { name: "Outbox complete", result: outbox },
    { name: "Refund completeness", result: refunds },
  ];

  // Verify exactly 1 success booking per seat
  for (const seatID of seatIDs) {
    const check = await verifier.exactlyOneSuccess(eventID, seatID);
    checks.push({ name: `Exactly 1 winner for seat ${seatID.slice(0, 8)}…`, result: check });
  }

  const got201 = results.filter((r) => r.status === 201).length;
  const got409 = results.filter((r) => r.status === 409).length;
  checks.push({
    name: `Exactly ${SEATS} bookings returned 201`,
    result:
      got201 === SEATS
        ? { pass: true, detail: `${got201} winners` }
        : { pass: false, detail: `Got ${got201} winners, expected ${SEATS}` },
  });
  checks.push({
    name: `${SEATS * USERS_PER_SEAT - SEATS} bookings returned 409`,
    result:
      got409 === SEATS * USERS_PER_SEAT - SEATS
        ? { pass: true, detail: `${got409} conflicts` }
        : {
            pass: false,
            detail: `Got ${got409} conflicts, expected ${SEATS * USERS_PER_SEAT - SEATS}`,
          },
  });

  reporter.reportScenario(
    `Chaos Mix — ${SEATS} seats × ${USERS_PER_SEAT} users (slow chaos)`,
    results
  );
  reporter.reportVerification(checks);

  const passed = checks.every((c) => c.result.pass);
  return { eventID, passed };
}

export { run };
