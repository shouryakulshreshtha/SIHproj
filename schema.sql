-- ============================================================
-- Truck Relay App — core schema for tracking + payments
-- ============================================================

-- A "trip" is one truck journey, which may be handed off between
-- multiple drivers (the relay part of your model).
CREATE TABLE IF NOT EXISTS trips (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_id        UUID NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active', -- active | completed | cancelled
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Which driver is currently responsible for the truck on this trip
-- (changes every ~10hr shift). Useful for tying location pings to
-- the right person and for shift handoff audit trails.
CREATE TABLE IF NOT EXISTS trip_shifts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         UUID NOT NULL REFERENCES trips(id),
  driver_id       UUID NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ
);

-- Latest known location per trip (upserted on every ping).
-- Keep this table small & hot — it's read on every poll/WS connect.
CREATE TABLE IF NOT EXISTS trip_locations (
  trip_id         UUID PRIMARY KEY REFERENCES trips(id),
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  accuracy_m      DOUBLE PRECISION,          -- reported GPS accuracy in meters
  speed_kmh       DOUBLE PRECISION,
  heading_deg     DOUBLE PRECISION,
  source          TEXT NOT NULL,             -- gps | network | last_known | ip_geo
  recorded_at     TIMESTAMPTZ NOT NULL,      -- when the device took the reading
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Optional: full history for replay / disputes / analytics.
CREATE TABLE IF NOT EXISTS trip_location_history (
  id              BIGSERIAL PRIMARY KEY,
  trip_id         UUID NOT NULL REFERENCES trips(id),
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  accuracy_m      DOUBLE PRECISION,
  source          TEXT NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trip_location_history_trip_time
  ON trip_location_history (trip_id, recorded_at DESC);

-- Bookings = the shipment/order a customer pays for.
CREATE TABLE IF NOT EXISTS bookings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id             UUID REFERENCES trips(id),
  customer_id         UUID NOT NULL,
  total_amount_paise  BIGINT NOT NULL,      -- store money as integer paise
  advance_amount_paise BIGINT NOT NULL,
  balance_amount_paise BIGINT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending_advance',
  -- pending_advance | advance_paid | in_transit | pending_balance | completed | cancelled
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per Razorpay order we create (advance and balance are separate orders).
CREATE TABLE IF NOT EXISTS payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        UUID NOT NULL REFERENCES bookings(id),
  leg               TEXT NOT NULL,          -- 'advance' | 'balance'
  razorpay_order_id TEXT UNIQUE NOT NULL,
  razorpay_payment_id TEXT,
  amount_paise      BIGINT NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'INR',
  status            TEXT NOT NULL DEFAULT 'created', -- created | paid | failed
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency ledger for Razorpay webhooks. The UNIQUE constraint on
-- event_id is what makes duplicate webhook deliveries a no-op.
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id      TEXT PRIMARY KEY,   -- Razorpay's x-razorpay-event-id (or payload.event + entity id)
  event_type    TEXT NOT NULL,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
