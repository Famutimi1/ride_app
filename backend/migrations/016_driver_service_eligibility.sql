ALTER TABLE driver_profiles
  ADD COLUMN vehicle_category TEXT CHECK (vehicle_category IN ('car','motorcycle')),
  ADD COLUMN ride_service_status TEXT NOT NULL DEFAULT 'none' CHECK (ride_service_status IN ('none','pending','approved','rejected','suspended')),
  ADD COLUMN courier_service_status TEXT NOT NULL DEFAULT 'none' CHECK (courier_service_status IN ('none','pending','approved','rejected','suspended')),
  ADD COLUMN accepts_ride BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN service_review_details JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(service_review_details)='object'),
  ADD COLUMN service_consent_history JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(service_consent_history)='array'),
  ADD COLUMN service_settings_version INTEGER NOT NULL DEFAULT 0;

-- Only rows present at upgrade receive passenger compatibility. Never infer a car
-- from make/model, or invent a historical consent record for an existing driver.
UPDATE driver_profiles SET
  ride_service_status=CASE WHEN status='approved' THEN 'approved' WHEN status='pending' THEN 'pending' ELSE 'none' END,
  accepts_ride=(status='approved'),
  service_review_details=jsonb_build_object('legacyPassengerApproval',status='approved','legacyCourierPreference',accepts_courier),
  accepts_courier=false;

ALTER TABLE driver_profiles
  ADD CONSTRAINT passenger_vehicle_category CHECK (vehicle_category IS DISTINCT FROM 'motorcycle' OR (ride_service_status NOT IN ('approved','pending') AND NOT accepts_ride)),
  ADD CONSTRAINT ride_preference_requires_approval CHECK (NOT accepts_ride OR ride_service_status='approved'),
  ADD CONSTRAINT courier_preference_requires_approval CHECK (NOT accepts_courier OR courier_service_status='approved');

-- One durable service predicate for maps, dispatch, recovery and assignment.
-- Availability, financial state and trip locks are checked by the matching module.
CREATE FUNCTION driver_service_enabled(profile driver_profiles, service TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(profile.status='approved' AND
    CASE service
      WHEN 'ride' THEN profile.ride_service_status='approved' AND profile.accepts_ride
        AND (profile.vehicle_category='car' OR (profile.vehicle_category IS NULL AND profile.service_review_details->>'legacyPassengerApproval'='true'))
      WHEN 'courier' THEN profile.courier_service_status='approved' AND profile.accepts_courier
        AND profile.vehicle_category IN ('car','motorcycle')
      ELSE false
    END
    AND (
      (service='ride' AND profile.service_review_details->>'legacyPassengerApproval'='true')
      OR COALESCE((SELECT entry->>'action'='accepted' AND entry->>'version'='service-choice-2026-10-16'
        FROM jsonb_array_elements(profile.service_consent_history) WITH ORDINALITY AS history(entry,position)
        WHERE entry->>'service'=service ORDER BY position DESC LIMIT 1),false)
    ),false)
$$;

CREATE FUNCTION protect_driver_service_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF jsonb_array_length(NEW.service_consent_history)<jsonb_array_length(OLD.service_consent_history)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(OLD.service_consent_history) WITH ORDINALITY AS old_entry(value,position)
      WHERE NEW.service_consent_history->(position::integer-1) IS DISTINCT FROM value)
  THEN RAISE EXCEPTION 'service_consent_history_is_append_only'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER driver_service_consent_append_only BEFORE UPDATE OF service_consent_history ON driver_profiles
FOR EACH ROW EXECUTE FUNCTION protect_driver_service_consent();
