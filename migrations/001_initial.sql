-- Venues
CREATE TABLE IF NOT EXISTS venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT NOT NULL
);

-- Seats (belong to a venue, not an event)
CREATE TABLE IF NOT EXISTS seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  label TEXT NOT NULL  -- e.g. "A1", "B12"
);

-- Events
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  venue_id UUID NOT NULL REFERENCES venues(id)
);

-- Bookings
-- status: 'pending' | 'success'
-- A booking is considered 'rejected' if status='pending' AND created_at + 30min < now()
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  seat_id UUID NOT NULL REFERENCES seats(id),
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success')),
  payment_session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Idempotency: one active booking per (event, seat, user)
  UNIQUE (event_id, seat_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_bookings_event_seat ON bookings(event_id, seat_id);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_session ON bookings(payment_session_id);

-- Outbox for at-least-once delivery of refund requests
CREATE TABLE IF NOT EXISTS outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,          -- e.g. 'refund'
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ     -- NULL = unprocessed
);

CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed ON outbox(processed_at) WHERE processed_at IS NULL;
