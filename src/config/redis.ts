import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL as string);

redis.on("error", (err: Error) => {
  console.error("Redis error:", err);
});

export { redis };
