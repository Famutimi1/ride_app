-- Trip system schema. The economy prices below are development placeholders.
DO $$ BEGIN CREATE TYPE trip_status AS ENUM ('searching','driver_assigned','driver_arrived','in_progress','completed','cancelled','no_drivers_found'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payment_method AS ENUM ('cash','wallet','card'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE trip_cancelled_by AS ENUM ('rider','driver','system'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE offer_status AS ENUM ('sent','accepted','declined','expired','rescinded'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS rating_avg NUMERIC(3,2) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rating_count INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS fare_config (
  vehicle_type VARCHAR(20) PRIMARY KEY,
  base_fare_kobo BIGINT NOT NULL CHECK (base_fare_kobo >= 0),
  per_km_kobo BIGINT NOT NULL CHECK (per_km_kobo >= 0),
  per_min_kobo BIGINT NOT NULL CHECK (per_min_kobo >= 0),
  min_fare_kobo BIGINT NOT NULL CHECK (min_fare_kobo >= 0),
  commission_bps INT NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO fare_config (vehicle_type, base_fare_kobo, per_km_kobo, per_min_kobo, min_fare_kobo, commission_bps)
VALUES ('economy', 80000, 25000, 3500, 120000, 1500)
ON CONFLICT (vehicle_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID NOT NULL REFERENCES users(id),
  driver_id UUID REFERENCES users(id),
  status trip_status NOT NULL DEFAULT 'searching',
  vehicle_type VARCHAR(20) NOT NULL DEFAULT 'economy' REFERENCES fare_config(vehicle_type),
  payment_method payment_method NOT NULL,
  pickup_lat DOUBLE PRECISION NOT NULL CHECK (pickup_lat BETWEEN -90 AND 90),
  pickup_lng DOUBLE PRECISION NOT NULL CHECK (pickup_lng BETWEEN -180 AND 180),
  pickup_address TEXT NOT NULL,
  pickup_place_id TEXT,
  dropoff_lat DOUBLE PRECISION NOT NULL CHECK (dropoff_lat BETWEEN -90 AND 90),
  dropoff_lng DOUBLE PRECISION NOT NULL CHECK (dropoff_lng BETWEEN -180 AND 180),
  dropoff_address TEXT NOT NULL,
  dropoff_place_id TEXT,
  estimated_distance_m INT NOT NULL CHECK (estimated_distance_m > 0),
  estimated_duration_s INT NOT NULL CHECK (estimated_duration_s > 0),
  route_polyline TEXT,
  fare_kobo BIGINT NOT NULL CHECK (fare_kobo > 0),
  commission_kobo BIGINT,
  driver_earning_kobo BIGINT,
  idempotency_key VARCHAR(80) NOT NULL,
  cancelled_by trip_cancelled_by,
  cancel_reason VARCHAR(200),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rider_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_trip_per_rider ON trips(rider_id)
  WHERE status IN ('searching','driver_assigned','driver_arrived','in_progress');
CREATE UNIQUE INDEX IF NOT EXISTS one_active_trip_per_driver ON trips(driver_id)
  WHERE driver_id IS NOT NULL AND status IN ('driver_assigned','driver_arrived','in_progress');
CREATE INDEX IF NOT EXISTS idx_trips_rider_created ON trips(rider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trips_driver_created ON trips(driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);

CREATE TABLE IF NOT EXISTS trip_status_history (
  id BIGSERIAL PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES trips(id),
  from_status trip_status,
  to_status trip_status NOT NULL,
  actor_id UUID REFERENCES users(id),
  actor_type VARCHAR(10) NOT NULL CHECK (actor_type IN ('rider','driver','system')),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tsh_trip ON trip_status_history(trip_id, created_at);

CREATE TABLE IF NOT EXISTS trip_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id),
  driver_id UUID NOT NULL REFERENCES users(id),
  status offer_status NOT NULL DEFAULT 'sent',
  distance_to_pickup_m INT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  UNIQUE (trip_id, driver_id)
);
CREATE INDEX IF NOT EXISTS idx_offers_driver ON trip_offers(driver_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS trip_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id),
  rater_id UUID NOT NULL REFERENCES users(id),
  ratee_id UUID NOT NULL REFERENCES users(id),
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment VARCHAR(300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trip_id, rater_id)
);

CREATE TABLE IF NOT EXISTS trip_locations (
  id BIGSERIAL PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES trips(id),
  lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  recorded_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tl_trip ON trip_locations(trip_id, recorded_at);

-- Signed amounts: positive credits, negative debits. Rows are immutable.
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  trip_id UUID REFERENCES trips(id),
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo <> 0),
  entry_type VARCHAR(40) NOT NULL,
  idempotency_key VARCHAR(120) NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wallet_user_created ON wallet_transactions(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION reject_append_only_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trip_status_history_append_only ON trip_status_history;
CREATE TRIGGER trip_status_history_append_only BEFORE UPDATE OR DELETE ON trip_status_history
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
DROP TRIGGER IF EXISTS wallet_transactions_append_only ON wallet_transactions;
CREATE TRIGGER wallet_transactions_append_only BEFORE UPDATE OR DELETE ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
