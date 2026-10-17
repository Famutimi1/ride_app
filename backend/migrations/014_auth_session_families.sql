-- Staff must sign in again; customer refresh credentials remain usable.
ALTER TABLE refresh_tokens ADD COLUMN session_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE refresh_tokens ADD COLUMN session_started_at TIMESTAMPTZ;
UPDATE refresh_tokens SET session_started_at=issued_at;
ALTER TABLE refresh_tokens ALTER COLUMN session_started_at SET DEFAULT now();
ALTER TABLE refresh_tokens ALTER COLUMN session_started_at SET NOT NULL;
UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE session_scope='staff';
CREATE INDEX refresh_session_family ON refresh_tokens(user_id,session_id);
CREATE UNIQUE INDEX refresh_one_active_family ON refresh_tokens(session_id) WHERE revoked_at IS NULL;
CREATE FUNCTION protect_refresh_session_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id<>OLD.user_id OR NEW.session_id<>OLD.session_id
     OR NEW.session_started_at<>OLD.session_started_at OR NEW.session_scope<>OLD.session_scope
     OR NEW.token_hash<>OLD.token_hash THEN
    RAISE EXCEPTION 'refresh_session_identity_is_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_refresh_identity BEFORE UPDATE ON refresh_tokens
FOR EACH ROW EXECUTE FUNCTION protect_refresh_session_identity();
