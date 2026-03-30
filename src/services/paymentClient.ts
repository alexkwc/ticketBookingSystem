import http from "http";
import https from "https";
import type { PaymentSession, PaymentStatusResponse } from "../types";

const PAYMENT_URL = process.env.PAYMENT_SERVICE_URL ?? "http://localhost:4000";

interface HttpResponse {
  status: number | undefined;
  body: unknown;
}

function request(method: string, path: string, body: unknown): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(PAYMENT_URL + path);
    const lib = url.protocol === "https:" ? https : http;
    const data = body ? JSON.stringify(body) : undefined;

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, body: raw });
          }
        });
      }
    );

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Ask the payment service to create a new payment session.
 * @returns PaymentSession or throws if service is down
 */
async function createPaymentSession(params: {
  bookingID: string;
  userID: string;
  amount: number;
}): Promise<PaymentSession> {
  const res = await request("POST", "/sessions", params);
  if (res.status !== undefined && res.status >= 500) {
    throw Object.assign(new Error("Payment service unavailable"), { status: 502 });
  }
  return res.body as PaymentSession;
}

/**
 * Fetch the current status of a payment session.
 */
async function getPaymentStatus(sessionID: string): Promise<PaymentStatusResponse> {
  const res = await request("GET", `/sessions/${sessionID}`, null);
  if (res.status !== undefined && res.status >= 500) {
    throw Object.assign(new Error("Payment service unavailable"), { status: 502 });
  }
  return res.body as PaymentStatusResponse;
}

/**
 * Request a refund for a session.
 */
async function refundSession(sessionID: string): Promise<unknown> {
  const res = await request("POST", `/sessions/${sessionID}/refund`, {});
  if (res.status !== undefined && res.status >= 500) {
    throw Object.assign(new Error("Payment service unavailable"), { status: 502 });
  }
  return res.body;
}

export { createPaymentSession, getPaymentStatus, refundSession };
