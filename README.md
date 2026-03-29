# Ticket Booking System

A distributed ticket booking system demonstrating production-grade patterns for handling concurrent seat reservations under load.

## What This Demonstrates

- **Redis distributed locking** — atomic seat reservation with `SET NX` preventing double-booking
- **Idempotency** — duplicate booking requests are safe; duplicate payment webhooks are safe
- **Outbox pattern** — refund requests survive transient payment service failures via at-least-once delivery
- **Derived state** — `rejected` status is never written to the DB; computed at read time from `created_at`
- **Dual confirmation** — webhook + BullMQ delayed job fallback ensure payment is always reconciled

## Architecture

| Service | Technology | Role |
|---|---|---|
| API | Node.js + Express | Booking creation, webhook handling |
| Database | PostgreSQL 16 | Bookings, outbox, events, seats |
| Cache / Locks | Redis 7 | Distributed seat locks via `SET NX` |
| Job Queue | BullMQ | Delayed payment check job at minute 30 |
| Payment | Mock HTTP service | Session creation, refunds, webhook callbacks |
| Workers | Node.js | Outbox processor, BullMQ job runner |

## Running the App

```bash
docker compose up --build
```

- API: http://localhost:3000
- Mock payment service: http://localhost:4000

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/events` | Paginated event listing (`cursor`, `limit`, `date`, `host`) |
| `GET` | `/events/:id` | Event detail with seat availability |
| `POST` | `/bookings` | Create booking — body: `{ eventID, seatID }`, header: `x-user-id` |
| `POST` | `/webhooks/payment` | Payment completion callback — body: `{ paymentSessionID, status }` |
| `GET` | `/health` | Health check |

### Create Booking

```bash
curl -X POST http://localhost:3000/bookings \
  -H "Content-Type: application/json" \
  -H "x-user-id: <uuid>" \
  -d '{"eventID": "<uuid>", "seatID": "<uuid>"}'
```

Response:
```json
{ "bookingID": "...", "status": "pending", "checkoutURL": "http://localhost:4000/checkout/..." }
```

Errors:
- `409` — seat already locked (another booking in progress)
- `503` — payment service unavailable

## Load Test + Chaos Monkey

The load test suite exercises the system's correctness invariants under concurrent load and injected failures.

### Run the Load Test

```bash
# Option A: start app + run load test in one command
docker compose --profile load-test up --build

# Option B: app already running, run test once interactively
docker compose up -d --build
docker compose --profile load-test run --rm load-test

# Option C: run directly (app already running locally)
npm run load-test
```

The load-test container exits with code `0` (all pass) or `1` (any failure). All app services keep running.

### Scenarios

| Scenario | Description | Key Assertion |
|---|---|---|
| **Baseline** | 50 users book 50 different seats concurrently | All 50 return 201, no double bookings |
| **Seat Contention** | 30 users race for 1 seat | Exactly 1 wins (201), 29 get 409 |
| **Payment Chaos** | Wave 1 (10 seats) succeeds; chaos mode `down`; wave 2 (10 seats) fires | Wave 2 all get 503; wave 1 seats confirmed |
| **Webhook Idempotency** | Webhook fires once + 2 manual duplicates sent directly | Duplicates return 200 (idempotent accept); booking has exactly 1 success row |
| **Chaos Mix** | 5 users per seat × 3 seats, payment `slow` | 3 winners, refunds in outbox, all processed |

### Correctness Invariants Verified

- No seat has more than one `success` booking
- No `rejected` status is ever written to the database
- All pending+non-expired bookings have a corresponding Redis lock
- All displaced bookings (lost the seat race) have an outbox refund entry
- All outbox entries are eventually processed

### Chaos Modes

The mock payment service exposes chaos control endpoints used by the test runner:

| Endpoint | Effect |
|---|---|
| `POST /test/chaos/down` | All payment endpoints return 503 |
| `POST /test/chaos/slow` | All payment endpoints add 2–5s random delay |
| `POST /test/chaos/reset` | Restore normal operation |
| `GET /test/chaos/status` | Query current chaos mode |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgres://...@localhost:5432/ticketbooking` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `PAYMENT_SERVICE_URL` | `http://localhost:4000` | Payment service base URL |
| `BOOKING_WINDOW_MINUTES` | `30` | Minutes until a pending booking expires |
| `LOCK_TTL_SECONDS` | `1920` | Redis lock TTL (32 min = 30 min window + 2 min buffer) |
| `PORT` | `3000` | API server port |

> The load-test container sets `BOOKING_WINDOW_MINUTES=2` so scenarios that test expiry don't need to wait 30 minutes.

## Data Model

```
Event       { id, name, host, date, venueID }
Venue       { id, name, address }
Seat        { id, venueID, label }
Booking     { id, eventID, seatID, userID, createdAt, status, paymentSessionID }
              status ∈ { 'pending', 'success' }  — 'rejected' is derived, never stored
              unique on (event_id, seat_id, user_id)
Outbox      { id, type, payload, createdAt, processedAt }
              type = 'refund', processedAt NULL = unprocessed
```
