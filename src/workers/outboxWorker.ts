import "dotenv/config";
import { pool } from "../config/db";
import { refundSession } from "../services/paymentClient";
import type { OutboxItem } from "../types";

const POLL_INTERVAL_MS = 5000;
const BATCH_SIZE = 10;

async function processOutbox(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock unprocessed rows so concurrent workers don't double-process
    const { rows } = await client.query<OutboxItem>(
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
        await client.query(`UPDATE outbox SET processed_at = now() WHERE id = $1`, [item.id]);
      } catch (err) {
        console.error(`Outbox item ${item.id} failed:`, (err as Error).message);
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

async function run(): Promise<void> {
  console.log("Outbox worker started");
  while (true) {
    await processOutbox();
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

run().catch((err: Error) => {
  console.error("Outbox worker fatal error:", err);
  process.exit(1);
});
