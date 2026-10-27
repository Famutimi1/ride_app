-- Reuse the existing call lifecycle, reservations, outbox and session ownership.
ALTER TABLE call_sessions
  ADD COLUMN media TEXT NOT NULL DEFAULT 'audio' CHECK (media IN ('audio','video')),
  ADD COLUMN requested_media TEXT NOT NULL DEFAULT 'audio' CHECK (requested_media IN ('audio','video')),
  ADD COLUMN video_reason TEXT,
  ADD COLUMN video_policy_until TIMESTAMPTZ;

CREATE FUNCTION downgrade_trip_video_calls() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('in_progress','returning') THEN
    PERFORM trip_id FROM trip_communications WHERE trip_id=NEW.id FOR UPDATE;
    UPDATE call_sessions SET media='audio',video_reason='video_before_trip_only',video_policy_until=NULL,
      generation=generation+1,version=version+1,caller_ready=false,callee_ready=false,
      status=CASE WHEN status='ringing' THEN 'ringing' ELSE 'connecting' END,
      deadline_at=LEAST(deadline_at,now()+interval '30 seconds')
    WHERE trip_id=NEW.id AND media='video' AND ended_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trips_video_lifecycle AFTER UPDATE OF status ON trips
FOR EACH ROW EXECUTE FUNCTION downgrade_trip_video_calls();
