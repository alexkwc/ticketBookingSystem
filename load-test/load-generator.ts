import { v4 as uuidv4 } from "uuid";
import * as http from "./http";
import { API_URL } from "./config";

export interface BookingRequest {
  id: string;
  url: string;
  headers: Record<string, string>;
  body: { eventID: string; seatID: string };
}

export interface BookingResult {
  id: string;
  status: number | undefined | null;
  body: unknown;
  durationMs: number;
  error: string | null;
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fire all requests simultaneously and collect results.
 * Never rejects — network errors are captured in result.error.
 */
async function runConcurrent(requests: BookingRequest[]): Promise<BookingResult[]> {
  const promises = requests.map(async (req) => {
    const reqStart = Date.now();
    try {
      const result = await http.post(req.url, req.body, req.headers);
      return {
        id: req.id,
        status: result.status,
        body: result.body,
        durationMs: Date.now() - reqStart,
        error: null,
      };
    } catch (err) {
      return {
        id: req.id,
        status: null,
        body: null,
        durationMs: Date.now() - reqStart,
        error: (err as Error).message,
      };
    }
  });

  return Promise.all(promises);
}

/**
 * Build booking requests — one per (seatID, userID) pair at the same index.
 */
function buildBookingRequests(params: {
  eventID: string;
  seatIDs: string[];
  userIDs: string[];
}): BookingRequest[] {
  return params.seatIDs.map((seatID, i) => ({
    id: `booking-${i}`,
    url: `${API_URL}/bookings`,
    headers: { "x-user-id": params.userIDs[i], "content-type": "application/json" },
    body: { eventID: params.eventID, seatID },
  }));
}

/**
 * Build `count` booking requests all targeting the same seatID with unique userIDs.
 */
function buildContestedRequests(params: {
  eventID: string;
  seatID: string;
  count: number;
}): BookingRequest[] {
  return Array.from({ length: params.count }, (_, i) => ({
    id: `contest-${i}`,
    url: `${API_URL}/bookings`,
    headers: { "x-user-id": uuidv4(), "content-type": "application/json" },
    body: { eventID: params.eventID, seatID: params.seatID },
  }));
}

/**
 * Extract sessionID from a checkoutURL like http://payment:4000/checkout/{sessionID}
 */
function extractSessionID(checkoutURL: string | undefined): string | null {
  if (!checkoutURL) return null;
  return checkoutURL.split("/").pop() ?? null;
}

export { runConcurrent, buildBookingRequests, buildContestedRequests, extractSessionID, waitMs };
