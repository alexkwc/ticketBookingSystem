import * as http from "./http";
import { PAYMENT_URL } from "./config";

async function setFaultMode(mode: string): Promise<string> {
  const res = await http.post(`${PAYMENT_URL}/test/fault/${mode}`);
  if (res.status !== 200) {
    throw new Error(`Failed to set fault mode '${mode}': HTTP ${res.status}`);
  }
  return (res.body as { faultMode: string }).faultMode;
}

async function withFault<T>(mode: string, fn: () => Promise<T>): Promise<T> {
  await setFaultMode(mode);
  try {
    return await fn();
  } finally {
    await setFaultMode("reset");
  }
}

export { setFaultMode, withFault };
