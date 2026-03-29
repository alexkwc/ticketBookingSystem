const { Pool } = require("pg");
const Redis = require("ioredis");
const config = require("./config");

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: config.DATABASE_URL });
    pool.on("error", (err) => console.error("DB pool error:", err.message));
  }
  return pool;
}

async function query(sql, params) {
  const { rows } = await getPool().query(sql, params);
  return rows;
}

async function queryOne(sql, params) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function withTransaction(fn) {
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

function createRedis() {
  const client = new Redis(config.REDIS_URL, { lazyConnect: true });
  client.on("error", (err) => console.error("Redis error:", err.message));
  return client;
}

async function close() {
  if (pool) await pool.end();
}

module.exports = { query, queryOne, withTransaction, createRedis, close };
