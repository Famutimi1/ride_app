-- New bookings retain their commission basis. Historical records are not guessed.
ALTER TABLE trips ADD COLUMN commission_bps_snapshot INTEGER CHECK(commission_bps_snapshot BETWEEN 0 AND 10000);
CREATE FUNCTION protect_trip_commission_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.commission_bps_snapshot IS NOT NULL AND NEW.commission_bps_snapshot IS DISTINCT FROM OLD.commission_bps_snapshot THEN
  RAISE EXCEPTION 'trip_commission_snapshot_is_immutable';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trip_commission_snapshot_immutable BEFORE UPDATE ON trips FOR EACH ROW EXECUTE FUNCTION protect_trip_commission_snapshot();
