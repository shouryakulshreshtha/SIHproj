-- =====================================================================
-- RELAY FREIGHT PLATFORM — CORE DATABASE SCHEMA (PostgreSQL + PostGIS)
-- =====================================================================
-- Run `CREATE EXTENSION IF NOT EXISTS postgis;` on the DB before this.
-- Organized to match the feature list: users/roles, vehicles, trips,
-- relay segments/handovers, load consolidation, payments, ratings,
-- disputes, and ML/anomaly support tables.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------
-- 1. USERS & ROLES
-- ---------------------------------------------------------------------

CREATE TYPE user_role AS ENUM ('shipper', 'driver', 'hub_ops', 'admin');

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role            user_role NOT NULL,
    name            VARCHAR(120) NOT NULL,
    phone           VARCHAR(15) UNIQUE NOT NULL,
    email           VARCHAR(150) UNIQUE,
    password_hash   TEXT NOT NULL,
    preferred_language VARCHAR(20) DEFAULT 'en',
    rating_avg      NUMERIC(3,2) DEFAULT 5.00,   -- two-way ratings roll up here
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE shipper_profiles (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    company_name    VARCHAR(150),
    gst_number      VARCHAR(20),
    credit_limit    NUMERIC(12,2)          -- for B2B monthly billing
);

CREATE TYPE driver_verification_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE driver_profiles (
    user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    license_number      VARCHAR(30) NOT NULL,
    license_expiry      DATE,
    verification_status driver_verification_status DEFAULT 'pending',
    kyc_ref             VARCHAR(100),        -- DigiLocker/third-party KYC reference, not raw Aadhaar
    preferred_zones     TEXT[],              -- e.g. {'Delhi-Jaipur','Jaipur-Ahmedabad'}
    is_online           BOOLEAN DEFAULT FALSE,
    max_driving_minutes_per_segment INT DEFAULT 270,  -- ~4.5 hr Rivigo-style cap
    referred_by         UUID REFERENCES users(id)
);

CREATE TYPE doc_type AS ENUM ('license', 'rc', 'insurance', 'fitness', 'pollution', 'national_permit', 'state_permit');
CREATE TYPE doc_status AS ENUM ('pending', 'approved', 'rejected', 'expired');

CREATE TABLE driver_documents (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id   UUID NOT NULL REFERENCES driver_profiles(user_id) ON DELETE CASCADE,
    doc_type    doc_type NOT NULL,
    file_url    TEXT NOT NULL,           -- stored encrypted at rest
    status      doc_status DEFAULT 'pending',
    expiry_date DATE,
    uploaded_at TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2. VEHICLES & GOODS REFERENCE TABLES
-- ---------------------------------------------------------------------

CREATE TABLE vehicle_types (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(50) UNIQUE NOT NULL,   -- 'TATA ACE', 'EICHER 19FT', '40FT OPEN TRAILER'...
    max_weight_kg   NUMERIC(10,2) NOT NULL,
    max_volume_cbm  NUMERIC(10,2),
    base_fare       NUMERIC(10,2) NOT NULL,
    per_km_rate     NUMERIC(10,2) NOT NULL,
    sort_order      INT DEFAULT 0
);

CREATE TABLE vehicles (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_driver_id     UUID NOT NULL REFERENCES driver_profiles(user_id),
    vehicle_type_id     INT NOT NULL REFERENCES vehicle_types(id),
    registration_number VARCHAR(20) UNIQUE NOT NULL,
    capacity_weight_kg  NUMERIC(10,2),
    capacity_volume_cbm NUMERIC(10,2),
    status              VARCHAR(20) DEFAULT 'active'  -- active / maintenance / suspended
);

CREATE TABLE goods_types (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(80) UNIQUE NOT NULL,    -- 'FMCG / Food Items', 'ODC Consignment', ...
    is_hazmat_prone BOOLEAN DEFAULT FALSE        -- flags categories needing the hazmat checkbox
);

-- ---------------------------------------------------------------------
-- 3. HUBS (relay handover points)
-- ---------------------------------------------------------------------

CREATE TABLE hubs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL,
    location        GEOGRAPHY(POINT, 4326) NOT NULL,
    address         TEXT,
    facilities      JSONB,             -- {"parking":true,"food":true,"security":true}
    operating_hours JSONB
);

-- ---------------------------------------------------------------------
-- 4. TRIPS, STOPS, SEGMENTS
-- ---------------------------------------------------------------------

CREATE TYPE trip_mode AS ENUM ('single', 'relay');
CREATE TYPE trip_status AS ENUM (
    'requested', 'quoted', 'confirmed', 'in_progress',
    'delivered', 'cancelled', 'disputed'
);

CREATE TABLE trips (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipper_id          UUID NOT NULL REFERENCES users(id),
    vehicle_type_id     INT NOT NULL REFERENCES vehicle_types(id),
    goods_type_id       INT NOT NULL REFERENCES goods_types(id),
    weight_kg           NUMERIC(10,2) NOT NULL,
    volume_cbm          NUMERIC(10,2),          -- volumetric weight computed at app layer
    is_hazardous        BOOLEAN DEFAULT FALSE,   -- blocks auto-booking, needs ops approval
    mode                trip_mode NOT NULL DEFAULT 'single',
    status              trip_status NOT NULL DEFAULT 'requested',
    pickup_location     GEOGRAPHY(POINT, 4326) NOT NULL,
    pickup_address      TEXT,
    drop_location       GEOGRAPHY(POINT, 4326) NOT NULL,
    drop_address        TEXT,
    scheduled_at        TIMESTAMPTZ,             -- null = instant booking
    allow_consolidation BOOLEAN DEFAULT FALSE,    -- opt-in for shared-trip matching
    fare_estimated      NUMERIC(10,2),
    fare_final          NUMERIC(10,2),
    advance_payment_pct SMALLINT DEFAULT 80 CHECK (advance_payment_pct IN (80, 90, 100)),
    insurance_opted     BOOLEAN DEFAULT FALSE,
    insurance_premium   NUMERIC(10,2),
    eway_bill_number    VARCHAR(30),
    eway_bill_valid_until TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT now()
);

-- Multi-stop support for a single shipper's booking (distinct from consolidation)
CREATE TYPE stop_type AS ENUM ('pickup', 'waypoint', 'drop');

CREATE TABLE trip_stops (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_id     UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    sequence_no SMALLINT NOT NULL,
    stop_type   stop_type NOT NULL,
    location    GEOGRAPHY(POINT, 4326) NOT NULL,
    address     TEXT,
    status      VARCHAR(20) DEFAULT 'pending',
    UNIQUE (trip_id, sequence_no)
);

CREATE TYPE segment_status AS ENUM (
    'assigned', 'en_route_to_pickup', 'loading', 'in_transit',
    'at_hub', 'handed_off', 'completed'
);

-- One row per relay leg; a 'single' mode trip has exactly one segment.
CREATE TABLE segments (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_id             UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    sequence_no         SMALLINT NOT NULL,
    driver_id           UUID REFERENCES driver_profiles(user_id),
    vehicle_id          UUID REFERENCES vehicles(id),
    hub_from_id         UUID REFERENCES hubs(id),   -- null for first segment
    hub_to_id           UUID REFERENCES hubs(id),   -- null for last segment
    distance_km         NUMERIC(8,2),
    estimated_minutes   INT,                        -- feeds ETA model / STA breach alerts
    status              segment_status DEFAULT 'assigned',
    started_at          TIMESTAMPTZ,
    ended_at            TIMESTAMPTZ,
    UNIQUE (trip_id, sequence_no)
);

-- ---------------------------------------------------------------------
-- 5. HANDOVERS (relay-specific)
-- ---------------------------------------------------------------------

CREATE TABLE handovers (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    segment_from_id     UUID NOT NULL REFERENCES segments(id),
    segment_to_id       UUID NOT NULL REFERENCES segments(id),
    hub_id              UUID NOT NULL REFERENCES hubs(id),
    otp_code            VARCHAR(6),
    qr_token            TEXT,
    checklist           JSONB,          -- {"seal_intact":true,"fuel_pct":80,"damage":false,...}
    photo_urls          TEXT[],
    disputed            BOOLEAN DEFAULT FALSE,
    dispute_notes       TEXT,
    confirmed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 6. LOAD CONSOLIDATION (shared trips / PTL)
-- ---------------------------------------------------------------------
-- Lets a second (or third) shipper's cargo ride on a segment that already
-- belongs to a primary trip, when remaining capacity allows it.

CREATE TABLE consolidated_shipments (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    segment_id          UUID NOT NULL REFERENCES segments(id),
    passenger_trip_id   UUID NOT NULL REFERENCES trips(id),  -- the "added on" shipper's trip
    weight_kg           NUMERIC(10,2) NOT NULL,
    volume_cbm          NUMERIC(10,2),
    fare_share          NUMERIC(10,2),        -- this shipment's cut of the segment's total fare
    pod_status          VARCHAR(20) DEFAULT 'pending',  -- separate POD per shipment
    joined_at           TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 7. LIVE LOCATION (high-volume; consider partitioning by day in prod)
-- ---------------------------------------------------------------------

CREATE TABLE location_pings (
    id          BIGSERIAL PRIMARY KEY,
    driver_id   UUID NOT NULL REFERENCES driver_profiles(user_id),
    segment_id  UUID REFERENCES segments(id),
    location    GEOGRAPHY(POINT, 4326) NOT NULL,
    speed_kmph  NUMERIC(5,2),
    source      VARCHAR(10) DEFAULT 'gps',   -- gps / cell_triangulation / app_ping (fallback chain)
    recorded_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_location_pings_segment ON location_pings(segment_id, recorded_at);

-- ---------------------------------------------------------------------
-- 8. PAYMENTS, PAYOUTS, DETENTION, CANCELLATION
-- ---------------------------------------------------------------------

CREATE TYPE payment_type AS ENUM ('advance', 'balance', 'detention', 'cancellation_fee', 'insurance_premium');
CREATE TYPE payment_mode AS ENUM ('upi', 'card', 'netbanking', 'imps', 'neft', 'cash');

CREATE TABLE payments (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_id     UUID NOT NULL REFERENCES trips(id),
    payer_id    UUID NOT NULL REFERENCES users(id),
    type        payment_type NOT NULL,
    mode        payment_mode NOT NULL,
    amount      NUMERIC(10,2) NOT NULL,
    gateway_ref VARCHAR(100),           -- Razorpay payment/order id — used for idempotency
    status      VARCHAR(20) DEFAULT 'pending',
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (gateway_ref)                -- idempotent webhook handling
);

CREATE TABLE driver_payouts (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id   UUID NOT NULL REFERENCES driver_profiles(user_id),
    segment_id  UUID REFERENCES segments(id),
    amount      NUMERIC(10,2) NOT NULL,
    payout_ref  VARCHAR(100),          -- Razorpay Payouts reference (no wallet balance held)
    status      VARCHAR(20) DEFAULT 'pending',
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE detention_charges (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_id         UUID NOT NULL REFERENCES trips(id),
    stop_id         UUID REFERENCES trip_stops(id),
    free_minutes    INT DEFAULT 60,
    actual_minutes  INT,
    charge_amount   NUMERIC(10,2),
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TYPE cancellation_stage AS ENUM ('before_assignment', 'after_assignment', 'after_pickup');

CREATE TABLE cancellations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_id         UUID NOT NULL REFERENCES trips(id),
    cancelled_by    UUID NOT NULL REFERENCES users(id),
    stage           cancellation_stage NOT NULL,
    fee_amount      NUMERIC(10,2) DEFAULT 0,
    reason          TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 9. RATINGS, DISPUTES/INCIDENTS
-- ---------------------------------------------------------------------

CREATE TABLE ratings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_id         UUID NOT NULL REFERENCES trips(id),
    rated_by        UUID NOT NULL REFERENCES users(id),   -- two-way: shipper->driver or driver->shipper
    rated_user      UUID NOT NULL REFERENCES users(id),
    score           SMALLINT CHECK (score BETWEEN 1 AND 5),
    comment         TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TYPE incident_type AS ENUM ('damage', 'delay', 'behavior', 'accident', 'breakdown', 'theft', 'harassment');

CREATE TABLE incidents (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_id         UUID REFERENCES trips(id),
    segment_id      UUID REFERENCES segments(id),
    reported_by     UUID NOT NULL REFERENCES users(id),
    type            incident_type NOT NULL,
    status          VARCHAR(20) DEFAULT 'open',
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 10. ML / ANOMALY SUPPORT
-- ---------------------------------------------------------------------

CREATE TYPE anomaly_type AS ENUM (
    'gps_spoof', 'route_diversion', 'geofence_breach',
    'otp_failure', 'handover_mismatch', 'cancellation_pattern'
);

CREATE TABLE anomaly_flags (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_id     UUID REFERENCES trips(id),
    segment_id  UUID REFERENCES segments(id),
    driver_id   UUID REFERENCES driver_profiles(user_id),
    type        anomaly_type NOT NULL,
    risk_score  NUMERIC(5,2),          -- 0-100, model output
    details     JSONB,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Feature-flag table for staged rollout (ML pieces gated per corridor)
CREATE TABLE feature_flags (
    key         VARCHAR(60) PRIMARY KEY,   -- e.g. 'ml_matching', 'consolidation', 'fraud_v2'
    enabled     BOOLEAN DEFAULT FALSE,
    corridor    VARCHAR(100),              -- null = global
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Handy indexes for common queries
-- ---------------------------------------------------------------------
CREATE INDEX idx_trips_shipper ON trips(shipper_id);
CREATE INDEX idx_trips_status ON trips(status);
CREATE INDEX idx_segments_driver ON segments(driver_id);
CREATE INDEX idx_segments_status ON segments(status);
CREATE INDEX idx_trips_pickup_geo ON trips USING GIST (pickup_location);
CREATE INDEX idx_trips_drop_geo ON trips USING GIST (drop_location);
