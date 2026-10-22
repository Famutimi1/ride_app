-- Convert the existing restricted text column without changing any category.
-- NULL remains available for vehicles awaiting staff classification.
CREATE TYPE vehicle_category AS ENUM ('car', 'motorcycle');

-- Recreate the cross-column rule with enum operands after the type conversion.
ALTER TABLE driver_profiles
  DROP CONSTRAINT driver_profiles_vehicle_category_check,
  DROP CONSTRAINT passenger_vehicle_category;

ALTER TABLE driver_profiles
  ALTER COLUMN vehicle_category TYPE vehicle_category
  USING vehicle_category::vehicle_category;

ALTER TABLE driver_profiles
  ADD CONSTRAINT passenger_vehicle_category CHECK (
    vehicle_category IS DISTINCT FROM 'motorcycle'
    OR (ride_service_status NOT IN ('approved','pending') AND NOT accepts_ride)
  );
