-- Approved staff care records. No automatic customer alert/delivery channel is implied.
CREATE TABLE support_cases (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), customer_id UUID REFERENCES users(id),
 trip_id UUID REFERENCES trips(id), payment_id UUID REFERENCES payment_intents(id),
 category VARCHAR(40) NOT NULL CHECK(category IN ('trip','payment','account','other')),
 severity VARCHAR(12) NOT NULL CHECK(severity IN ('low','medium','high','critical')),
 status VARCHAR(24) NOT NULL DEFAULT 'new' CHECK(status IN ('new','assigned','waiting_customer','waiting_internal','resolved','reopened')),
 subject TEXT NOT NULL CHECK(length(subject) BETWEEN 5 AND 160),
 assigned_staff_id UUID REFERENCES users(id), response_due_at TIMESTAMPTZ,
 created_by UUID NOT NULL REFERENCES users(id), version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE safety_incidents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),customer_id UUID REFERENCES users(id),trip_id UUID REFERENCES trips(id),
 severity VARCHAR(12) NOT NULL CHECK(severity IN ('low','medium','high','critical')),
 status VARCHAR(24) NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','responding','resolved','reviewed')),
 subject TEXT NOT NULL CHECK(length(subject) BETWEEN 5 AND 160),
 next_action TEXT NOT NULL CHECK(length(next_action) BETWEEN 5 AND 1000),
 assigned_staff_id UUID REFERENCES users(id),created_by UUID NOT NULL REFERENCES users(id),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE care_activity (
 id BIGSERIAL PRIMARY KEY,case_id UUID REFERENCES support_cases(id),incident_id UUID REFERENCES safety_incidents(id),
 actor_id UUID NOT NULL REFERENCES users(id),kind VARCHAR(24) NOT NULL CHECK(kind IN ('created','note','state_change','assignment')),
 visibility VARCHAR(12) NOT NULL DEFAULT 'internal' CHECK(visibility IN ('internal','customer')),
 delivery_status VARCHAR(12) NOT NULL DEFAULT 'not_sent' CHECK(delivery_status IN ('not_sent','queued','delivered','failed')),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 5 AND 4000),metadata JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),CHECK(num_nonnulls(case_id,incident_id)=1)
);
CREATE INDEX support_case_queue ON support_cases(created_at DESC,id DESC);
CREATE INDEX safety_incident_queue ON safety_incidents(created_at DESC,id DESC);
CREATE INDEX care_case_activity ON care_activity(case_id,id DESC) WHERE case_id IS NOT NULL;
CREATE INDEX care_incident_activity ON care_activity(incident_id,id DESC) WHERE incident_id IS NOT NULL;
ALTER TABLE admin_audit_log ADD COLUMN object_type VARCHAR(40),ADD COLUMN object_id UUID,ADD COLUMN before_version JSONB,ADD COLUMN after_version JSONB;
CREATE INDEX admin_operation_lookup ON admin_audit_log(actor_id,request_key) WHERE request_key IS NOT NULL;
CREATE FUNCTION protect_admin_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'staff history is append-only'; END;
$$;
CREATE TRIGGER immutable_admin_audit BEFORE UPDATE OR DELETE ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION protect_admin_history();
CREATE TRIGGER immutable_admin_audit_truncate BEFORE TRUNCATE ON admin_audit_log FOR EACH STATEMENT EXECUTE FUNCTION protect_admin_history();
CREATE TRIGGER immutable_care_activity BEFORE UPDATE OR DELETE ON care_activity FOR EACH ROW EXECUTE FUNCTION protect_admin_history();
CREATE TRIGGER immutable_care_activity_truncate BEFORE TRUNCATE ON care_activity FOR EACH STATEMENT EXECUTE FUNCTION protect_admin_history();
