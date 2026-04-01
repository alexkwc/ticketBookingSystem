# Ticket Booking System

## Project overview
A distributed ticket booking system that handles concurrent seat reservations. The core challenge is preventing double-booking while remaining reliable under payment failures and service outages. This is a portfolio project demonstrating distributed systems patterns: Redis locking, idempotency, outbox pattern, and delayed job queues.

## Architecture
- **Backend**: Node.js + Express (TypeScript, compiled to `dist/` via `tsc`)
- **Database**: PostgreSQL
- **Cache / distributed locks**: Redis
- **Job queue**: BullMQ
- **Payment**: Mock payment service (simulate delays + webhook callbacks)
- **Tests**: Jest + ts-jest (unit tests for services)

## Key design decisions

### Seat locking
- On booking creation, acquire a Redis lock using SET NX with key `lock:{eventID}:{seatID}`
- Lock TTL is 32 minutes (2 minute buffer over the 30 minute user-facing window)
- If lock cannot be acquired, return 4xx — seat is taken

### Booking state machine
- States: `pending`, `success`, `rejected`
- `rejected` is a **derived state** — do not write it explicitly to the database
- A booking is considered rejected if: `createdAt + 30 minutes < now AND status = pending`
- Always apply this rule consistently at read time across all services

### Payment flow
1. Booking service creates booking with status `pending` and enqueues a delayed job to fire at minute 30
2. Booking service calls payment service to create a payment session, stores `paymentSessionID` on the booking
3. If payment service is unreachable, mark booking as `rejected` immediately (step 3.2)
4. User completes payment on the frontend
5. Payment service fires a webhook to booking service on completion
6. Booking service also polls payment status at minute 30 via the delayed job as a fallback

### Webhook idempotency
- Use `paymentSessionID` as the idempotency key
- First write wins — if duplicate webhook events arrive, skip processing on the second
- On receiving webhook, check payment status by session ID (step 6.1.1) before updating booking

### Seat confirmation transaction (step 7)
When marking a booking as success, do this atomically in a single transaction:
1. Check if a newer booking exists for the same `eventID + seatID`
2. If conflict exists (lock expired and someone else booked), do NOT mark success — trigger refund instead
3. Otherwise mark booking as `success`

### Refund via outbox pattern
- Write refund request to an `outbox` table in the **same transaction** as step 7
- A background worker polls the outbox and delivers to payment service with retries
- Payment service refund handler must be idempotent (use `paymentSessionID` as key)
- This ensures at-least-once delivery even if payment service is temporarily unavailable

## Data models
```sql
Event       { id, name, host, date, venueID }
Venue       { id, name, address }
Seat        { id, venueID }
Booking     { id, eventID, seatID, userID, createdAt, status, paymentSessionID }
Outbox      { id, type, payload, createdAt, processedAt }
```

Idempotency key: `eventID + seatID + userID`

## API endpoints
- `GET /events?param1=&param2=&cursor=` — paginated event listing
- `GET /events/:id` — event detail with seat availability
- `POST /bookings` — body: `{ eventID, seatID }` — create booking and acquire lock
- `POST /webhooks/payment` — receive payment completion callback

## Error handling conventions
- `4xx` — seat already taken (Redis lock exists)
- `5xx` — payment service down (mark as rejected, surface to user)
- Webhook failures — handled by delayed job fallback at minute 30

## What NOT to do
- Do not set booking status to `rejected` explicitly — derive it from `createdAt` timestamp
- Do not rely solely on webhooks — always have the delayed job fallback
- Do not perform the seat confirmation check outside of a transaction
- Do not send refund requests via direct call only — always write to outbox first