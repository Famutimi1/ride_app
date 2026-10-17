-- Courier orders share trip dispatch, payments, and the status history.
-- The delivery code is derived server-side and never stored in plaintext.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS service_type VARCHAR(12) NOT NULL DEFAULT 'ride'
  CHECK (service_type IN ('ride', 'courier'));
ALTER TABLE trips ADD COLUMN IF NOT EXISTS courier_details JSONB;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS delivery_attempts SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS delivery_verified_at TIMESTAMPTZ;
ALTER TABLE trips ADD CONSTRAINT courier_details_required
  CHECK ((service_type = 'ride' AND courier_details IS NULL) OR
         (service_type = 'courier' AND courier_details IS NOT NULL AND payment_method = 'wallet'));

-- Development tariff; operations should set approved commercial rates before launch.
INSERT INTO fare_config (vehicle_type, base_fare_kobo, per_km_kobo, per_min_kobo, min_fare_kobo, commission_bps)
VALUES ('courier', 100000, 30000, 2500, 150000, 1500)
ON CONFLICT (vehicle_type) DO NOTHING;
