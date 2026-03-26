const http = require("http");
const https = require("https");

const PAYMENT_URL = process.env.PAYMENT_SERVICE_URL || "http://localhost:4000";

function request(method, path, body) {
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
        res.on("data", (chunk) => (raw += chunk));
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
 * @returns {{ sessionID: string }} or throws if service is down
 */
async function createPaymentSession({ bookingID, userID, amount }) {
  const res = await request("POST", "/sessions", { bookingID, userID, amount });
  if (res.status >= 500) throw Object.assign(new Error("Payment service unavailable"), { status: 502 });
  return res.body; // { sessionID, checkoutURL }
}

/**
 * Fetch the current status of a payment session.
 * @returns {{ status: 'pending'|'paid'|'failed' }}
 */
async function getPaymentStatus(sessionID) {
  const res = await request("GET", `/sessions/${sessionID}`, null);
  if (res.status >= 500) throw Object.assign(new Error("Payment service unavailable"), { status: 502 });
  return res.body;
}

/**
 * Request a refund for a session.
 */
async function refundSession(sessionID) {
  const res = await request("POST", `/sessions/${sessionID}/refund`, {});
  if (res.status >= 500) throw Object.assign(new Error("Payment service unavailable"), { status: 502 });
  return res.body;
}

module.exports = { createPaymentSession, getPaymentStatus, refundSession };
