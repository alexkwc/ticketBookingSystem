import * as http from "./http";
import { PAYMENT_URL } from "./config";

async function setChaosMode(mode: string): Promise<string> {
  const res = await http.post(`${PAYMENT_URL}/test/chaos/${mode}`);
  if (res.status !== 200) {
    throw new Error(`Failed to set chaos mode '${mode}': HTTP ${res.status}`);
  }
  return (res.body as { chaosMode: string }).chaosMode;
}

async function withChaos<T>(mode: string, fn: () => Promise<T>): Promise<T> {
  await setChaosMode(mode);
  try {
    return await fn();
  } finally {
    await setChaosMode("reset");
  }
}

export { setChaosMode, withChaos };
