-- Deploy with chat writers drained during this transactional backfill. All new
-- and legacy message routes must use the serialized writer before resuming.
LOCK TABLE trips IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE trip_messages IN ACCESS EXCLUSIVE MODE;

CREATE TABLE trip_communications (
  trip_id UUID PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  rider_id UUID NOT NULL REFERENCES users(id),
  driver_id UUID NOT NULL REFERENCES users(id),
  status VARCHAR(6) NOT NULL CHECK (status IN ('open','closed')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  last_sequence BIGINT NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  rider_delivered_sequence BIGINT NOT NULL DEFAULT 0,
  rider_read_sequence BIGINT NOT NULL DEFAULT 0,
  driver_delivered_sequence BIGINT NOT NULL DEFAULT 0,
  driver_read_sequence BIGINT NOT NULL DEFAULT 0,
  receipt_version BIGINT NOT NULL DEFAULT 0,
  CHECK (rider_id <> driver_id),
  CHECK ((status='open' AND closed_at IS NULL) OR (status='closed' AND closed_at IS NOT NULL)),
  CHECK (rider_read_sequence BETWEEN 0 AND rider_delivered_sequence),
  CHECK (driver_read_sequence BETWEEN 0 AND driver_delivered_sequence),
  CHECK (rider_delivered_sequence <= last_sequence AND driver_delivered_sequence <= last_sequence)
);

INSERT INTO trip_communications(trip_id,rider_id,driver_id,status,opened_at,closed_at)
SELECT id,rider_id,driver_id,
  CASE WHEN status IN ('driver_assigned','driver_arrived','in_progress','returning') THEN 'open' ELSE 'closed' END,
  COALESCE(accepted_at,created_at),
  CASE WHEN status IN ('driver_assigned','driver_arrived','in_progress','returning') THEN NULL
       ELSE COALESCE(completed_at,cancelled_at,updated_at) END
FROM trips WHERE driver_id IS NOT NULL;

ALTER TABLE trip_messages ADD COLUMN sequence BIGINT;
WITH ordered AS (
  SELECT id,row_number() OVER (PARTITION BY trip_id ORDER BY id) AS sequence FROM trip_messages
)
UPDATE trip_messages m SET sequence=o.sequence FROM ordered o WHERE o.id=m.id;
ALTER TABLE trip_messages ALTER COLUMN sequence SET NOT NULL;
ALTER TABLE trip_messages ADD CONSTRAINT trip_messages_positive_sequence CHECK (sequence>0);
ALTER TABLE trip_messages ADD CONSTRAINT trip_messages_trip_sequence UNIQUE(trip_id,sequence);
ALTER TABLE trip_messages DROP CONSTRAINT trip_messages_body_check;
ALTER TABLE trip_messages ADD CONSTRAINT trip_messages_body_check CHECK (length(body) BETWEEN 1 AND 2000);
UPDATE trip_communications c SET last_sequence=s.sequence
FROM (SELECT trip_id,max(sequence) AS sequence FROM trip_messages GROUP BY trip_id) s
WHERE c.trip_id=s.trip_id;

-- The database observes accepted/closed trip state, including older server
-- binaries and maintenance writers. This trigger never changes trip status.
CREATE FUNCTION sync_trip_communication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.driver_id IS NOT NULL THEN
    INSERT INTO trip_communications(trip_id,rider_id,driver_id,status,opened_at,closed_at)
    VALUES(NEW.id,NEW.rider_id,NEW.driver_id,
      CASE WHEN NEW.status IN ('driver_assigned','driver_arrived','in_progress','returning') THEN 'open' ELSE 'closed' END,
      COALESCE(NEW.accepted_at,NEW.created_at),
      CASE WHEN NEW.status IN ('driver_assigned','driver_arrived','in_progress','returning') THEN NULL ELSE now() END)
    ON CONFLICT(trip_id) DO UPDATE SET
      status=CASE WHEN NEW.status IN ('driver_assigned','driver_arrived','in_progress','returning')
                       AND trip_communications.status='open'
                       AND trip_communications.driver_id=NEW.driver_id
                       AND trip_communications.rider_id=NEW.rider_id THEN 'open' ELSE 'closed' END,
      closed_at=CASE WHEN NEW.status IN ('driver_assigned','driver_arrived','in_progress','returning')
                          AND trip_communications.status='open'
                          AND trip_communications.driver_id=NEW.driver_id
                          AND trip_communications.rider_id=NEW.rider_id THEN NULL
                     ELSE COALESCE(trip_communications.closed_at,now()) END;
  ELSE
    UPDATE trip_communications SET status='closed',closed_at=COALESCE(closed_at,now()) WHERE trip_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trips_communication_lifecycle AFTER INSERT OR UPDATE OF status,driver_id,rider_id
ON trips FOR EACH ROW EXECUTE FUNCTION sync_trip_communication();

-- Every insert gets its sequence while holding the same trip -> conversation
-- lock order. The service checks retry keys before inserting. Never allocate
-- sequence numbers independently from the message transaction.
CREATE FUNCTION assign_trip_message_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM trips WHERE id=NEW.trip_id FOR UPDATE;
  UPDATE trip_communications SET last_sequence=last_sequence+1
  WHERE trip_id=NEW.trip_id RETURNING last_sequence INTO NEW.sequence;
  IF NOT FOUND THEN RAISE EXCEPTION 'trip_communication_missing' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trip_messages_sequence BEFORE INSERT ON trip_messages
FOR EACH ROW EXECUTE FUNCTION assign_trip_message_sequence();

CREATE TABLE communication_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  kind VARCHAR(24) NOT NULL CHECK (kind IN ('message_socket','message_push','receipt_socket')),
  message_id BIGINT REFERENCES trip_messages(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES users(id) ON DELETE CASCADE,
  event_key VARCHAR(180) NOT NULL UNIQUE,
  attempts INT NOT NULL DEFAULT 0 CHECK(attempts>=0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((lease_token IS NULL)=(lease_until IS NULL)),
  CHECK (kind='receipt_socket' OR message_id IS NOT NULL),
  CHECK (kind<>'message_push' OR recipient_id IS NOT NULL)
);
CREATE INDEX communication_outbox_pending ON communication_outbox(available_at,created_at)
WHERE dispatched_at IS NULL;
