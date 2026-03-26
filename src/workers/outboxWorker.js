require("dotenv").config();
const { pool } = require("../config/db");
const { refundSession } = require("../services/paymentClient");

const POLL_INTERVAL_MS = 5000;
const BATCH_SIZE = 10;

async function processOutbox() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock unprocessed rows so concurrent workers don't double-process
    const { rows } = await client.query(
      `SELECT * FROM outbox
       WHERE processed_at IS NULL
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE]
    );

    for (const item of rows) {
      try {
        if (item.type === "refund") {
          const { paymentSessionID } = item.payload;
          await refundSession(paymentSessionID);
        }
        // Mark processed inside the same transaction
        await client.query(
          `UPDATE outbox SET processed_at = now() WHERE id = $1`,
          [item.id]
        );
      } catch (err) {
        console.error(`Outbox item ${item.id} failed:`, err.message);
        // Leave processed_at NULL so it will be retried on next poll
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Outbox poll error:", err);
  } finally {
    client.release();
  }
}

async function run() {
  console.log("Outbox worker started");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await processOutbox();
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

run().catch((err) => {
  console.error("Outbox worker fatal error:", err);
  process.exit(1);
});
