import { Pool, PoolClient, QueryResultRow } from "pg";
import Redis from "ioredis";
import * as config from "./config";

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: config.DATABASE_URL });
    pool.on("error", (err: Error) => console.error("DB pool error:", err.message));
  }
  return pool;
}

async function query<T extends QueryResultRow = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const { rows } = await getPool().query<T>(sql, params);
  return rows;
}

async function queryOne<T extends QueryResultRow = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function createRedis(): Redis {
  const client = new Redis(config.REDIS_URL, { lazyConnect: true });
  client.on("error", (err: Error) => console.error("Redis error:", err.message));
  return client;
}

async function close(): Promise<void> {
  if (pool) await pool.end();
}

export { query, queryOne, withTransaction, createRedis, close };
