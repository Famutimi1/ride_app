-- Keep Expo registrations working while binding native call tokens to a login
-- session. Native tokens are encrypted by the application; hashes enforce token
-- uniqueness without storing plaintext provider credentials.
ALTER TABLE push_devices ADD COLUMN provider VARCHAR(16) NOT NULL DEFAULT 'expo'
  CHECK(provider IN ('expo','fcm','apns_voip'));
ALTER TABLE push_devices ALTER COLUMN expo_push_token DROP NOT NULL;
ALTER TABLE push_devices ADD COLUMN call_token_ciphertext TEXT;
ALTER TABLE push_devices ADD COLUMN call_token_hash CHAR(64);
ALTER TABLE push_devices ADD COLUMN session_id UUID;
ALTER TABLE push_devices ADD COLUMN call_protocol INT;
ALTER TABLE push_devices DROP CONSTRAINT push_devices_user_id_device_identifier_key;
ALTER TABLE push_devices ADD UNIQUE(user_id,device_identifier,provider);
ALTER TABLE push_devices ADD UNIQUE(provider,call_token_hash);
ALTER TABLE push_devices ADD CONSTRAINT push_devices_provider_token CHECK (
  (provider='expo' AND expo_push_token IS NOT NULL AND call_token_ciphertext IS NULL AND call_token_hash IS NULL)
  OR (provider IN ('fcm','apns_voip') AND expo_push_token IS NULL AND call_token_ciphertext IS NOT NULL
      AND call_token_hash IS NOT NULL AND session_id IS NOT NULL AND call_protocol IS NOT NULL AND call_protocol=1
      AND ((provider='fcm' AND platform='android') OR (provider='apns_voip' AND platform='ios')))
);

CREATE TABLE call_push_deliveries (
  id BIGSERIAL PRIMARY KEY,
  call_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
  status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','skipped','failed')),
  attempts INT NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  error_code VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(call_id,device_id)
);
CREATE INDEX call_push_deliveries_pending ON call_push_deliveries(available_at) WHERE status='pending';

CREATE OR REPLACE FUNCTION publish_call_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.version<>OLD.version THEN
    INSERT INTO call_outbox(call_id,version) VALUES(NEW.id,NEW.version);
  END IF;
  IF TG_OP='INSERT' THEN
    INSERT INTO call_push_deliveries(call_id,device_id)
    SELECT NEW.id,d.id FROM push_devices d JOIN users u ON u.id=d.user_id
    WHERE d.user_id=NEW.callee_id AND d.provider IN ('fcm','apns_voip') AND d.call_protocol=1
      AND d.enabled AND d.revoked_at IS NULL AND u.is_active AND EXISTS (
        SELECT 1 FROM refresh_tokens r WHERE r.user_id=d.user_id AND r.session_id=d.session_id
        AND r.session_scope='app' AND r.revoked_at IS NULL AND r.expires_at>now())
    ORDER BY d.last_seen_at DESC LIMIT 10;
  END IF;
  IF NEW.ended_at IS NOT NULL THEN
    DELETE FROM active_call_participants WHERE call_id=NEW.id;
    UPDATE call_push_deliveries SET status='skipped',error_code='call_ended' WHERE call_id=NEW.id AND status='pending';
  END IF;
  RETURN NEW;
END $$;
