const { v4: uuidv4 } = require("uuid");
const http = require("./http");
const config = require("./config");

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fire all requests simultaneously and collect results.
 * Never rejects — network errors are captured in result.error.
 */
async function runConcurrent(requests) {
  const start = Date.now();
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
        error: err.message,
      };
    }
  });

  return Promise.all(promises);
}

/**
 * Build booking requests — one per (seatID, userID) pair at the same index.
 */
function buildBookingRequests({ eventID, seatIDs, userIDs }) {
  return seatIDs.map((seatID, i) => ({
    id: `booking-${i}`,
    url: `${config.API_URL}/bookings`,
    headers: { "x-user-id": userIDs[i], "content-type": "application/json" },
    body: { eventID, seatID },
  }));
}

/**
 * Build `count` booking requests all targeting the same seatID with unique userIDs.
 */
function buildContestedRequests({ eventID, seatID, count }) {
  return Array.from({ length: count }, (_, i) => ({
    id: `contest-${i}`,
    url: `${config.API_URL}/bookings`,
    headers: { "x-user-id": uuidv4(), "content-type": "application/json" },
    body: { eventID, seatID },
  }));
}

/**
 * Extract sessionID from a checkoutURL like http://payment:4000/checkout/{sessionID}
 */
function extractSessionID(checkoutURL) {
  if (!checkoutURL) return null;
  return checkoutURL.split("/").pop();
}

module.exports = {
  runConcurrent,
  buildBookingRequests,
  buildContestedRequests,
  extractSessionID,
  waitMs,
};
