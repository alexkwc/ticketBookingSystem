/**
 * Scenario: Webhook idempotency (first-write-wins)
 * Create 1 booking, complete payment via test helper (fires webhook).
 * Then manually POST the same webhook event two more times.
 * Booking should have exactly 1 success row — no duplicate processing.
 */
import { v4 as uuidv4 } from "uuid";
import type Redis from "ioredis";
import * as fixtures from "../fixtures";
import * as gen from "../load-generator";
import * as verifier from "../verifier";
import * as http from "../http";
import { API_URL, PAYMENT_URL } from "../config";
import * as reporter from "../reporter";
import type { Check } from "../reporter";

async function run(redis: Redis): Promise<{ eventID: string; passed: boolean }> {
  const { eventID, seatIDs } = await fixtures.createScenarioData(1, "webhook-idempotency");
  const seatID = seatIDs[0];
  const userID = uuidv4();

  // Create booking
  const bookingRes = await http.post(
    `${API_URL}/bookings`,
    { eventID, seatID },
    { "x-user-id": userID, "content-type": "application/json" }
  );

  if (bookingRes.status !== 201) {
    const checks: Check[] = [
      {
        name: "Booking creation succeeded",
        result: { pass: false, detail: `Got HTTP ${bookingRes.status}` },
      },
    ];
    reporter.reportScenario("Webhook Idempotency", [
      { id: "booking", status: bookingRes.status, body: bookingRes.body, durationMs: 0, error: null },
    ]);
    reporter.reportVerification(checks);
    return { eventID, passed: false };
  }

  const sessionID = gen.extractSessionID(
    (bookingRes.body as { checkoutURL?: string }).checkoutURL
  );

  // Complete via test helper — fires one webhook automatically (with random delay)
  await http.post(`${PAYMENT_URL}/test/complete/${sessionID}`);
  await gen.waitMs(6000); // wait for the test helper's random delay + webhook processing

  // Fire duplicate webhooks directly to the booking service
  const dup1 = await http.post(
    `${API_URL}/webhooks/payment`,
    { paymentSessionID: sessionID, status: "paid" },
    { "content-type": "application/json" }
  );
  const dup2 = await http.post(
    `${API_URL}/webhooks/payment`,
    { paymentSessionID: sessionID, status: "paid" },
    { "content-type": "application/json" }
  );

  const core = await verifier.runAll(redis, { eventID, seatIDs, checkSeatID: seatID });
  const checks: Check[] = [...core.checks];

  checks.push({
    name: "Duplicate webhooks returned 200 (idempotent accept)",
    result:
      dup1.status === 200 && dup2.status === 200
        ? { pass: true, detail: "Both duplicates accepted without error" }
        : { pass: false, detail: `dup1=${dup1.status}, dup2=${dup2.status}` },
  });

  reporter.reportScenario("Webhook Idempotency — 1 booking + 2 duplicate webhooks", [
    { id: "booking", status: bookingRes.status, body: bookingRes.body, durationMs: 0, error: null },
    { id: "dup1", status: dup1.status, body: dup1.body, durationMs: 0, error: null },
    { id: "dup2", status: dup2.status, body: dup2.body, durationMs: 0, error: null },
  ]);
  reporter.reportVerification(checks);

  const passed = checks.every((c) => c.result.pass);
  return { eventID, passed };
}

export { run };
