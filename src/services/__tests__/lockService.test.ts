import { acquireLock, releaseLock } from "../lockService";

jest.mock("../../config/redis", () => ({
  redis: {
    set: jest.fn(),
    eval: jest.fn(),
  },
}));

import { redis } from "../../config/redis";

describe("lockService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("acquireLock", () => {
    it("returns the lockToken when the lock is acquired", async () => {
      (redis.set as jest.Mock).mockResolvedValue("OK");

      const result = await acquireLock("event-1", "seat-A", "token-abc");

      expect(result).toBe("token-abc");
      expect(redis.set).toHaveBeenCalledWith(
        "lock:event-1:seat-A",
        "token-abc",
        "EX",
        1920,
        "NX"
      );
    });

    it("returns null when the seat is already locked", async () => {
      (redis.set as jest.Mock).mockResolvedValue(null);

      const result = await acquireLock("event-1", "seat-A", "token-abc");

      expect(result).toBeNull();
    });

    it("uses a composite key of event and seat IDs", async () => {
      (redis.set as jest.Mock).mockResolvedValue("OK");

      await acquireLock("evt-999", "seat-Z", "some-token");

      expect(redis.set).toHaveBeenCalledWith(
        "lock:evt-999:seat-Z",
        expect.any(String),
        "EX",
        expect.any(Number),
        "NX"
      );
    });
  });

  describe("releaseLock", () => {
    it("calls redis eval with the correct key and token", async () => {
      (redis.eval as jest.Mock).mockResolvedValue(1);

      await releaseLock("event-1", "seat-A", "token-abc");

      const [script, numKeys, key, token] = (redis.eval as jest.Mock).mock
        .calls[0];
      expect(numKeys).toBe(1);
      expect(key).toBe("lock:event-1:seat-A");
      expect(token).toBe("token-abc");
      expect(script).toContain('redis.call("get"');
      expect(script).toContain('redis.call("del"');
    });

    it("does not throw when the token does not match (no-op)", async () => {
      (redis.eval as jest.Mock).mockResolvedValue(0);

      await expect(
        releaseLock("event-1", "seat-A", "wrong-token")
      ).resolves.toBeUndefined();
    });
  });
});
