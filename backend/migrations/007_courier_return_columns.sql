ALTER TABLE trips ADD COLUMN IF NOT EXISTS delivery_issue_reason VARCHAR(200);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ;

DROP INDEX IF EXISTS one_active_trip_per_rider;
CREATE UNIQUE INDEX one_active_trip_per_rider ON trips(rider_id)
  WHERE status IN ('searching','driver_assigned','driver_arrived','in_progress','returning');
DROP INDEX IF EXISTS one_active_trip_per_driver;
CREATE UNIQUE INDEX one_active_trip_per_driver ON trips(driver_id)
  WHERE driver_id IS NOT NULL AND status IN ('driver_assigned','driver_arrived','in_progress','returning');
