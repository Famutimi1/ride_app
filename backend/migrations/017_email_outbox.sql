-- Transactional email is independent of push delivery. Business actions and their
-- email requests commit together; Redis only schedules work already saved here.
CREATE TABLE email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_key VARCHAR(240) NOT NULL,
  recipient_key VARCHAR(254) NOT NULL,
  audience VARCHAR(10) NOT NULL CHECK (audience IN ('customer','admin')),
  recipient VARCHAR(254),
  template VARCHAR(60) NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL,
  subject VARCHAR(240) NOT NULL,
  status VARCHAR(24) NOT NULL CHECK (status IN ('waiting_email','waiting_admin','blocked','queued','sending','accepted','delivered','delayed','failed','bounced','complained','suppressed','uncertain','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  retryable BOOLEAN NOT NULL DEFAULT false,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  request JSONB,
  first_attempt_at TIMESTAMPTZ,
  provider_id UUID UNIQUE,
  last_error VARCHAR(120),
  accepted_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  provider_event_at TIMESTAMPTZ,
  provider_event_id VARCHAR(160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_key,recipient_key)
);
CREATE INDEX email_outbox_recovery ON email_outbox(status,next_attempt_at,lease_until);
CREATE INDEX email_outbox_history ON email_outbox(created_at DESC,id DESC);
CREATE INDEX email_outbox_user ON email_outbox(user_id,created_at DESC);
CREATE INDEX email_outbox_suppression ON email_outbox(lower(recipient)) WHERE status IN ('bounced','complained','suppressed');
