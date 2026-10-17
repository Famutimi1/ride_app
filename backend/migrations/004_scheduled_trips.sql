-- Advance bookings reuse trips and the existing trip state machine.
-- A scheduled trip has no driver or wallet hold until dispatch begins.
ALTER TYPE trip_status ADD VALUE IF NOT EXISTS 'scheduled';
ALTER TABLE trips ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_trips_scheduled_at ON trips(scheduled_at)
  WHERE scheduled_at IS NOT NULL;
