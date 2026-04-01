/**
 * Mock payment service.
 *
 * Endpoints:
 *   POST /sessions                     — create a payment session
 *   GET  /sessions/:id                 — get session status
 *   POST /sessions/:id/refund          — refund a session (idempotent by sessionID)
 *   POST /test/complete/:id            — (test helper) manually mark a session as paid and fire webhook
 */
import "dotenv/config";
import http from "http";
import { v4 as uuidv4 } from "uuid";

const PORT = process.env.PAYMENT_PORT ?? 4000;
const BOOKING_WEBHOOK_URL =
  (process.env.BOOKING_SERVICE_URL ?? "http://localhost:3000") + "/webhooks/payment";

interface Session {
  bookingID: string;
  userID: string;
  amount: number;
  status: string;
  refunded: boolean;
}

// In-memory store
const sessions = new Map<string, Session>();

// Fault injection control state
type FaultMode = "normal" | "down" | "slow";
let faultMode: FaultMode = "normal";

// Simulate random payment delays (ms) when auto-completing
const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 5000;

function randomDelay(): number {
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
}

function fireWebhook(sessionID: string, status: string): void {
  const body = JSON.stringify({ paymentSessionID: sessionID, status });
  const url = new URL(BOOKING_WEBHOOK_URL);
  const req = http.request(
    {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    },
    (res) => {
      console.log(`Webhook to booking service for session ${sessionID}: HTTP ${res.statusCode}`);
    }
  );
  req.on("error", (err: Error) => console.error("Webhook error:", err.message));
  req.write(body);
  req.end();
}

// Minimal JSON body parser
function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? (JSON.parse(data) as Record<string, unknown>) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(json);
}

const server = http.createServer(
  async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
      const parts = url.pathname.split("/").filter(Boolean);

      // Fault injection enforcement — skip for /test/fault/* management routes
      if (parts[1] !== "fault") {
        if (faultMode === "down") return send(res, 503, { error: "Service unavailable (fault injection)" });
        if (faultMode === "slow") {
          const delay = 2000 + Math.random() * 3000;
          await new Promise<void>((r) => setTimeout(r, delay));
        }
      }

      // POST /sessions
      if (req.method === "POST" && parts[0] === "sessions" && parts.length === 1) {
        const body = await readBody(req);
        const sessionID = uuidv4();
        sessions.set(sessionID, {
          bookingID: body.bookingID as string,
          userID: body.userID as string,
          amount: body.amount as number,
          status: "pending",
          refunded: false,
        });
        console.log(`Created session ${sessionID} for booking ${body.bookingID}`);
        return send(res, 201, {
          sessionID,
          checkoutURL: `http://localhost:${PORT}/checkout/${sessionID}`,
        });
      }

      // GET /sessions/:id
      if (req.method === "GET" && parts[0] === "sessions" && parts.length === 2) {
        const session = sessions.get(parts[1]);
        if (!session) return send(res, 404, { error: "Session not found" });
        return send(res, 200, { sessionID: parts[1], status: session.status });
      }

      // POST /sessions/:id/refund  (idempotent)
      if (req.method === "POST" && parts[0] === "sessions" && parts[2] === "refund") {
        const session = sessions.get(parts[1]);
        if (!session) return send(res, 404, { error: "Session not found" });
        if (!session.refunded) {
          session.refunded = true;
          session.status = "refunded";
          console.log(`Refunded session ${parts[1]}`);
        }
        return send(res, 200, { refunded: true });
      }

      // POST /test/complete/:id — test helper: mark paid and fire webhook
      if (req.method === "POST" && parts[0] === "test" && parts[1] === "complete") {
        const sessionID = parts[2];
        const session = sessions.get(sessionID);
        if (!session) return send(res, 404, { error: "Session not found" });

        setTimeout(() => {
          session.status = "paid";
          console.log(`Session ${sessionID} marked paid — firing webhook`);
          fireWebhook(sessionID, "paid");
        }, randomDelay());

        return send(res, 202, { message: "Payment will complete shortly" });
      }

      // POST /test/fail/:id — test helper: mark failed and fire webhook
      if (req.method === "POST" && parts[0] === "test" && parts[1] === "fail") {
        const sessionID = parts[2];
        const session = sessions.get(sessionID);
        if (!session) return send(res, 404, { error: "Session not found" });

        setTimeout(() => {
          session.status = "failed";
          console.log(`Session ${sessionID} marked failed — firing webhook`);
          fireWebhook(sessionID, "failed");
        }, randomDelay());

        return send(res, 202, { message: "Payment will fail shortly" });
      }

      // POST /test/fault/down | /test/fault/slow | /test/fault/reset
      if (req.method === "POST" && parts[0] === "test" && parts[1] === "fault") {
        const mode = parts[2];
        if (["down", "slow", "reset"].includes(mode)) {
          faultMode = mode === "reset" ? "normal" : (mode as FaultMode);
          console.log(`Fault mode set to: ${faultMode}`);
          return send(res, 200, { faultMode });
        }
      }

      // GET /test/fault/status
      if (
        req.method === "GET" &&
        parts[0] === "test" &&
        parts[1] === "fault" &&
        parts[2] === "status"
      ) {
        return send(res, 200, { faultMode });
      }

      send(res, 404, { error: "Not found" });
    } catch (err) {
      console.error(err);
      send(res, 500, { error: (err as Error).message });
    }
  }
);

server.listen(PORT, () => console.log(`Mock payment service listening on port ${PORT}`));
