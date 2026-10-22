-- Keep existing approvals and consent history; unclassified vehicles require staff
-- review. Every operational entry point already uses this shared predicate.
CREATE OR REPLACE FUNCTION driver_service_enabled(profile driver_profiles, service TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(profile.status='approved' AND
    CASE service
      WHEN 'ride' THEN profile.ride_service_status='approved' AND profile.accepts_ride
        AND profile.vehicle_category='car'
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
