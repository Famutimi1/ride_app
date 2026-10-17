CREATE TABLE push_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL UNIQUE CHECK (length(expo_push_token) BETWEEN 20 AND 512),
  platform VARCHAR(10) NOT NULL CHECK (platform IN ('ios','android')),
  device_identifier VARCHAR(160) NOT NULL,
  app_version VARCHAR(40),
  enabled BOOLEAN NOT NULL DEFAULT true,
  revoked_at TIMESTAMPTZ,
  revocation_reason VARCHAR(40),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_identifier)
);
CREATE INDEX push_devices_user_enabled ON push_devices(user_id) WHERE enabled AND revoked_at IS NULL;

CREATE TABLE notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  push_enabled BOOLEAN NOT NULL DEFAULT true,
  trip_updates_enabled BOOLEAN NOT NULL DEFAULT true,
  driver_offers_enabled BOOLEAN NOT NULL DEFAULT true,
  scheduled_reminders_enabled BOOLEAN NOT NULL DEFAULT true,
  wallet_updates_enabled BOOLEAN NOT NULL DEFAULT true,
  promotions_enabled BOOLEAN NOT NULL DEFAULT false,
  sound_enabled BOOLEAN NOT NULL DEFAULT true,
  vibration_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(60) NOT NULL,
  category VARCHAR(40) NOT NULL CHECK (category IN ('trip_updates','driver_offers','scheduled_reminders','wallet_updates','safety_security','support','promotions')),
  priority VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  event_key VARCHAR(180) NOT NULL,
  title VARCHAR(120) NOT NULL,
  body VARCHAR(240) NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  deep_link VARCHAR(200),
  expires_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  delivery_status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (delivery_status IN ('queued','sending','sent','delivered','skipped','failed')),
  delivery_attempts INT NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  push_ticket_ids JSONB NOT NULL DEFAULT '[]',
  last_delivery_error VARCHAR(240),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_key)
);
CREATE INDEX notifications_user_created ON notifications(user_id, created_at DESC, id DESC);
CREATE INDEX notifications_user_unread ON notifications(user_id, created_at DESC, id DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_trip_queued ON notifications((data->>'tripId'), created_at)
  WHERE delivery_status = 'queued' AND data ? 'tripId';
CREATE INDEX notifications_delivery_recovery ON notifications(delivery_status, updated_at)
  WHERE delivery_status IN ('queued','sending','sent');
