import "dotenv/config";
import * as config from "./config";
import * as db from "./db";
import * as fixtures from "./fixtures";
import * as reporter from "./reporter";
import type { ScenarioResult } from "./reporter";

import * as baseline from "./scenarios/baseline";
import * as contention from "./scenarios/contention";
import * as paymentChaos from "./scenarios/payment-chaos";
import * as webhookIdempotency from "./scenarios/webhook-idempotency";
import * as chaosMix from "./scenarios/chaos-mix";

import type Redis from "ioredis";

interface ScenarioModule {
  run: (redis: Redis) => Promise<{ eventID: string; passed: boolean }>;
}

interface Scenario {
  name: string;
  module: ScenarioModule;
}

const SCENARIOS: Scenario[] = [
  { name: "Baseline", module: baseline },
  { name: "Seat Contention", module: contention },
  { name: "Payment Chaos", module: paymentChaos },
  { name: "Webhook Idempotency", module: webhookIdempotency },
  { name: "Chaos Mix", module: chaosMix },
];

async function main(): Promise<void> {
  console.log("\n══════════════════════════════════════");
  console.log("  TICKET BOOKING SYSTEM — LOAD TEST");
  console.log("══════════════════════════════════════");
  console.log(`  API     : ${config.API_URL}`);
  console.log(`  Payment : ${config.PAYMENT_URL}`);
  console.log(`  Window  : ${config.BOOKING_WINDOW_MINUTES} minutes`);
  console.log("══════════════════════════════════════\n");

  const redis = db.createRedis();
  await redis.connect();

  // Clean up any leftover data from previous interrupted runs
  console.log("  Setting up fixtures...");
  await fixtures.setup();

  const allResults: ScenarioResult[] = [];

  for (const { name, module } of SCENARIOS) {
    const start = Date.now();
    let scenarioResult: { eventID: string; passed: boolean } | undefined;
    try {
      scenarioResult = await module.run(redis);
      allResults.push({
        name,
        passed: scenarioResult.passed,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      reporter.reportError(name, err as Error);
      allResults.push({
        name,
        passed: false,
        error: (err as Error).message,
        durationMs: Date.now() - start,
      });
      if (scenarioResult?.eventID) {
        await fixtures.cleanupScenario(scenarioResult.eventID).catch(() => {});
      }
      continue;
    }

    // Cleanup scenario data
    if (scenarioResult.eventID) {
      await fixtures
        .cleanupScenario(scenarioResult.eventID)
        .catch((err: Error) => console.error(`  Cleanup error for ${name}:`, err.message));
    }
  }

  await fixtures.teardown();
  reporter.reportSummary(allResults);

  await redis.quit();
  await db.close();

  const allPassed = allResults.every((r) => r.passed);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err: Error) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
