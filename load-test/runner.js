require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const config = require("./config");
const db = require("./db");
const fixtures = require("./fixtures");
const reporter = require("./reporter");

const baseline = require("./scenarios/baseline");
const contention = require("./scenarios/contention");
const paymentChaos = require("./scenarios/payment-chaos");
const webhookIdempotency = require("./scenarios/webhook-idempotency");
const chaosMix = require("./scenarios/chaos-mix");

const SCENARIOS = [
  { name: "Baseline", module: baseline },
  { name: "Seat Contention", module: contention },
  { name: "Payment Chaos", module: paymentChaos },
  { name: "Webhook Idempotency", module: webhookIdempotency },
  { name: "Chaos Mix", module: chaosMix },
];

async function main() {
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

  const allResults = [];

  for (const { name, module } of SCENARIOS) {
    const start = Date.now();
    let scenarioResult;
    try {
      scenarioResult = await module.run(redis);
      allResults.push({
        name,
        passed: scenarioResult.passed,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      reporter.reportError(name, err);
      allResults.push({ name, passed: false, error: err.message, durationMs: Date.now() - start });
      // Attempt cleanup even on error
      if (scenarioResult && scenarioResult.eventID) {
        await fixtures.cleanupScenario(scenarioResult.eventID).catch(() => {});
      }
      continue;
    }

    // Cleanup scenario data
    if (scenarioResult.eventID) {
      await fixtures.cleanupScenario(scenarioResult.eventID).catch((err) =>
        console.error(`  Cleanup error for ${name}:`, err.message)
      );
    }
  }

  await fixtures.teardown();
  reporter.reportSummary(allResults);

  await redis.quit();
  await db.close();

  const allPassed = allResults.every((r) => r.passed);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
