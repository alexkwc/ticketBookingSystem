const Redis = require("ioredis");

// Shared client for general use (locking, etc.)
const redis = new Redis(process.env.REDIS_URL);

redis.on("error", (err) => {
  console.error("Redis error:", err);
});

module.exports = { redis };
