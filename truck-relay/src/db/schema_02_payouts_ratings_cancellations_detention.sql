-- ============================================================
-- Migration 02: Driver payouts, ratings, cancellations, detention
-- ============================================================

-- ---------- DRIVER PAYOUTS (Razorpay Payouts / RazorpayX) ----------
-- No app-level wallet: driver balances are never held inside our own
-- system. We accumulate "earnings" rows as they're generated, then
-- transfer real money out via Razorpay Payouts when a payout is run.

CREATE TABLE IF NOT EXISTS driver_payout_accounts (
  driver_id               UUID PRIMARY KEY,
  razorpay_contact_id     TEXT NOT NULL,
  razorpay_fund_account_id TEXT NOT NULL,
  account_type            TEXT NOT NULL,  -- 'bank_account' | 'vpa' (UPI)
  verified                BOOLEAN NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS driver_payouts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id           UUID NOT NULL,
  razorpay_payout_id  TEXT UNIQUE,
  idempotency_key     TEXT UNIQUE NOT NULL,
  amount_paise        BIGINT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'initiated',
  -- initiated | processing | processed | failed | reversed
  mode                TEXT NOT NULL DEFAULT 'IMPS', -- IMPS | NEFT | UPI
  failure_reason      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every earning event (a shift's fare share, a detention bonus, etc)
-- lands here as 'pending' until it's swept into a payout batch.
CREATE TABLE IF NOT EXISTS driver_earnings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID NOT NULL,
  trip_id     UUID REFERENCES trips(id),
  shift_id    UUID REFERENCES trip_shifts(id),
  amount_paise BIGINT NOT NULL,
  reason      TEXT NOT NULL, -- 'shift_fare' | 'detention_bonus' | 'adjustment'
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | queued | paid_out | failed
  payout_id   UUID REFERENCES driver_payouts(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- RATINGS ----------

CREATE TABLE IF NOT EXISTS ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID NOT NULL REFERENCES trips(id),
  booking_id  UUID REFERENCES bookings(id),
  rater_role  TEXT NOT NULL, -- 'customer' | 'driver'
  rater_id    UUID NOT NULL,
  ratee_id    UUID NOT NULL,
  stars       SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trip_id, rater_id, ratee_id) -- one rating per person per trip
);

-- Precomputed aggregate so profile views don't run AVG() over the
-- whole ratings table every time.
CREATE TABLE IF NOT EXISTS driver_rating_summary (
  driver_id     UUID PRIMARY KEY,
  avg_rating    NUMERIC(3,2) NOT NULL DEFAULT 0,
  ratings_count INTEGER NOT NULL DEFAULT 0
);

-- ---------- CANCELLATIONS ----------

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancellation_stage TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancellation_fee_paise BIGINT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_by_role TEXT; -- 'customer' | 'driver' | 'admin'

-- ---------- DETENTION CHARGES ----------
-- One row per stop (pickup/delivery) per trip. Detention = time spent
-- waiting beyond the free window, billed to the customer and paid to
-- the driver as extra earning.

CREATE TABLE IF NOT EXISTS stop_events (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id                     UUID NOT NULL REFERENCES trips(id),
  booking_id                  UUID REFERENCES bookings(id),
  stop_type                   TEXT NOT NULL, -- 'pickup' | 'delivery'
  arrived_at                  TIMESTAMPTZ,
  departed_at                 TIMESTAMPTZ,
  free_minutes                INTEGER NOT NULL DEFAULT 120,
  detention_rate_paise_per_hour BIGINT NOT NULL DEFAULT 20000, -- ₹200/hr default
  detention_minutes           INTEGER,
  detention_charge_paise      BIGINT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
