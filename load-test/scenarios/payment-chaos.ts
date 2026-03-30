/**
 * Scenario: Graceful degradation under payment service failure
 * Wave 1 (10 bookings) fires while payment is up — all succeed.
 * Chaos enabled. Wave 2 (10 bookings) fires — payment service is down, all get 503.
 * Chaos reset. Wave 1 payments complete.
 * Verifies: wave 1 seats have success bookings, wave 2 seats have none.
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

const WAVE_SIZE = 10;

async function run(redis: Redis): Promise<{ eventID: string; passed: boolean }> {
  const { eventID, seatIDs } = await fixtures.createScenarioData(WAVE_SIZE * 2, "payment-chaos");
  const wave1Seats = seatIDs.slice(0, WAVE_SIZE);
  const wave2Seats = seatIDs.slice(WAVE_SIZE);

  // Wave 1 — payment service up
  const wave1Requests: BookingRequest[] = wave1Seats.map((seatID, i) => ({
    id: `w1-${i}`,
    url: `${API_URL}/bookings`,
    headers: { "x-user-id": uuidv4(), "content-type": "application/json" },
    body: { eventID, seatID },
  }));
  const wave1Results = await gen.runConcurrent(wave1Requests);

  // Enable chaos
  await chaos.setChaosMode("down");

  // Wave 2 — payment service down
  const wave2Requests: BookingRequest[] = wave2Seats.map((seatID, i) => ({
    id: `w2-${i}`,
    url: `${API_URL}/bookings`,
    headers: { "x-user-id": uuidv4(), "content-type": "application/json" },
    body: { eventID, seatID },
  }));
  const wave2Results = await gen.runConcurrent(wave2Requests);

  // Reset chaos
  await chaos.setChaosMode("reset");

  // Complete wave 1 payments
  for (const r of wave1Results.filter((r) => r.status === 201)) {
    const sessionID = gen.extractSessionID((r.body as { checkoutURL?: string }).checkoutURL);
    if (sessionID) {
      await http.post(`${PAYMENT_URL}/test/complete/${sessionID}`);
    }
  }
  await gen.waitMs(5000);

  const core = await verifier.runAll(redis, { eventID, seatIDs });
  const checks: Check[] = [...core.checks];

  const wave1Got201 = wave1Results.filter((r) => r.status === 201).length;
  const wave2Got503 = wave2Results.filter((r) => r.status === 503).length;

  checks.push({
    name: `Wave 1: all ${WAVE_SIZE} bookings returned 201`,
    result:
      wave1Got201 === WAVE_SIZE
        ? { pass: true, detail: `${wave1Got201}/${WAVE_SIZE} succeeded` }
        : { pass: false, detail: `Only ${wave1Got201}/${WAVE_SIZE} got 201` },
  });
  checks.push({
    name: `Wave 2: all ${WAVE_SIZE} bookings returned 503`,
    result:
      wave2Got503 === WAVE_SIZE
        ? { pass: true, detail: `${wave2Got503}/${WAVE_SIZE} got 503` }
        : {
            pass: false,
            detail: `${wave2Got503}/${WAVE_SIZE} got 503 (rest: ${WAVE_SIZE - wave2Got503} other)`,
          },
  });

  reporter.reportScenario(
    "Payment Chaos — wave1 up / wave2 down",
    [...wave1Results, ...wave2Results]
  );
  reporter.reportVerification(checks);

  const passed = checks.every((c) => c.result.pass);
  return { eventID, passed };
}

export { run };
