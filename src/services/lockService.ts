import { redis } from "../config/redis";

const LOCK_TTL = parseInt(process.env.LOCK_TTL_SECONDS ?? "1920"); // 32 minutes

function lockKey(eventID: string, seatID: string): string {
  return `lock:${eventID}:${seatID}`;
}

/**
 * Attempt to acquire a Redis lock for a seat.
 * Uses SET NX EX (atomic, no Lua needed for a single key).
 * @returns lockToken if acquired, null if seat is already locked
 */
async function acquireLock(
  eventID: string,
  seatID: string,
  lockToken: string
): Promise<string | null> {
  const key = lockKey(eventID, seatID);
  const result = await redis.set(key, lockToken, "EX", LOCK_TTL, "NX");
  return result === "OK" ? lockToken : null;
}

/**
 * Release a lock only if the token matches (prevents releasing someone else's lock).
 * Uses a Lua script for atomicity.
 */
async function releaseLock(
  eventID: string,
  seatID: string,
  lockToken: string
): Promise<void> {
  const key = lockKey(eventID, seatID);
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  await redis.eval(script, 1, key, lockToken);
}

export { acquireLock, releaseLock };
