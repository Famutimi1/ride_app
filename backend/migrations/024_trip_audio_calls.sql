-- Audio media travels over WebRTC/TURN. Only call metadata is persisted here.
CREATE TABLE call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id),
  caller_id UUID NOT NULL REFERENCES users(id),
  callee_id UUID NOT NULL REFERENCES users(id),
  caller_session_id UUID NOT NULL,
  callee_session_id UUID,
  request_id UUID NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ringing' CHECK(status IN ('ringing','connecting','connected','ended','declined','cancelled','missed','failed')),
  version INT NOT NULL DEFAULT 1 CHECK(version>0),
  generation INT NOT NULL DEFAULT 1 CHECK(generation>0),
  caller_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  callee_seen_at TIMESTAMPTZ,
  caller_ready BOOLEAN NOT NULL DEFAULT false,
  callee_ready BOOLEAN NOT NULL DEFAULT false,
  deadline_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '30 seconds',
  connected_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  end_reason VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(caller_id,request_id),
  CHECK(caller_id<>callee_id),
  CHECK((status IN ('ringing','connecting','connected'))=(ended_at IS NULL)),
  CHECK(status NOT IN ('connecting','connected') OR callee_session_id IS NOT NULL)
);
CREATE INDEX call_sessions_due ON call_sessions(deadline_at) WHERE ended_at IS NULL;
CREATE TABLE active_call_participants (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  call_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE
);
CREATE INDEX active_call_participants_call ON active_call_participants(call_id);
CREATE TABLE call_outbox (
  id BIGSERIAL PRIMARY KEY,
  call_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  version INT NOT NULL,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(call_id,version)
);
CREATE INDEX call_outbox_pending ON call_outbox(available_at) WHERE dispatched_at IS NULL;
CREATE FUNCTION publish_call_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.version<>OLD.version THEN
    INSERT INTO call_outbox(call_id,version) VALUES(NEW.id,NEW.version);
  END IF;
  IF NEW.ended_at IS NOT NULL THEN
    DELETE FROM active_call_participants WHERE call_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER call_sessions_publish AFTER INSERT OR UPDATE ON call_sessions
FOR EACH ROW EXECUTE FUNCTION publish_call_transition();

-- Same lock order as commands/recovery: trip -> conversation -> sorted user
-- advisory locks -> call -> reservations. Closure and call termination commit
-- together even when an older trip writer makes the transition.
CREATE FUNCTION close_trip_audio_calls() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE participant UUID;
BEGIN
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id OR NEW.rider_id IS DISTINCT FROM OLD.rider_id
     OR NEW.status NOT IN ('driver_assigned','driver_arrived','in_progress','returning') THEN
    PERFORM trip_id FROM trip_communications WHERE trip_id=NEW.id FOR UPDATE;
    FOR participant IN SELECT user_id FROM (
      SELECT caller_id AS user_id FROM call_sessions WHERE trip_id=NEW.id AND ended_at IS NULL
      UNION SELECT callee_id FROM call_sessions WHERE trip_id=NEW.id AND ended_at IS NULL
    ) participants ORDER BY user_id LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('audio-call:'||participant::text,0));
    END LOOP;
    UPDATE call_sessions SET status='ended',end_reason='trip_closed',ended_at=now(),version=version+1
    WHERE trip_id=NEW.id AND ended_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trips_audio_lifecycle AFTER UPDATE OF status,driver_id,rider_id ON trips
FOR EACH ROW EXECUTE FUNCTION close_trip_audio_calls();
