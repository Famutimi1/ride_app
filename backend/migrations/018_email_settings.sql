-- Owner-approved, persistent controls shared by all backend instances.
CREATE TABLE email_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id=true),
  enabled BOOLEAN NOT NULL DEFAULT true,
  rules JSONB NOT NULL CHECK (jsonb_typeof(rules)='object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>0),
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO email_settings(id,rules) VALUES(true,'{"welcome_rider":true,"welcome_driver":true,"admin_signup":true,"application_received":true,"admin_application":true,"driver_approved":true,"driver_rejected":true,"driver_service_updates":true,"wallet_updates":true,"withdrawal_updates":true,"trip_receipts":true,"support_updates":true}');

ALTER TABLE email_outbox ADD COLUMN control_key VARCHAR(40);
WITH decisions AS (
  SELECT id,CASE WHEN jsonb_typeof(payload->'services')='array' THEN payload->'services' ELSE '[]'::jsonb END AS services
  FROM email_outbox
)
UPDATE email_outbox e SET control_key=CASE
  WHEN template IN ('welcome_rider','welcome_driver','admin_signup','application_received','admin_application','test') THEN template
  WHEN template='application_reviewed' THEN CASE
    WHEN jsonb_array_length(d.services)>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d.services) s WHERE s->>'status' IS DISTINCT FROM 'approved') THEN 'driver_approved'
    WHEN jsonb_array_length(d.services)>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d.services) s WHERE s->>'status' IS DISTINCT FROM 'rejected') THEN 'driver_rejected'
    ELSE 'driver_service_updates' END
  WHEN payload->>'appPath'='/account/support' OR event_key LIKE 'activity:care:support:%' THEN 'support_updates'
  WHEN payload->>'appPath'='/account/driver-wallet' OR event_key LIKE 'activity:withdrawal:%' THEN 'withdrawal_updates'
  WHEN payload->>'appPath' IN ('/account/trips','/account/driver-trips') OR event_key LIKE 'activity:trip:%' THEN 'trip_receipts'
  ELSE 'wallet_updates' END
FROM decisions d WHERE e.id=d.id;
ALTER TABLE email_outbox ALTER COLUMN control_key SET NOT NULL;
ALTER TABLE email_outbox ADD CONSTRAINT email_control_key CHECK (control_key IN ('welcome_rider','welcome_driver','admin_signup','application_received','admin_application','driver_approved','driver_rejected','driver_service_updates','wallet_updates','withdrawal_updates','trip_receipts','support_updates','test'));
