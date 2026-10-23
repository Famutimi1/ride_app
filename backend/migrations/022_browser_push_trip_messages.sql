CREATE TABLE trip_messages (
 id BIGSERIAL PRIMARY KEY,
 trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
 sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 sender_role VARCHAR(8) NOT NULL CHECK(sender_role IN ('rider','driver')),
 client_message_id VARCHAR(120) NOT NULL CHECK(length(client_message_id) BETWEEN 1 AND 120),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(trip_id,sender_id,client_message_id)
);
CREATE INDEX trip_messages_history ON trip_messages(trip_id,id DESC);

CREATE TABLE web_push_subscriptions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_id UUID NOT NULL,
 endpoint_hash CHAR(64) NOT NULL UNIQUE,
 endpoint TEXT NOT NULL CHECK(length(endpoint) BETWEEN 10 AND 2048),
 p256dh VARCHAR(128) NOT NULL,
 auth VARCHAR(64) NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 last_delivered_at TIMESTAMPTZ,
 last_error VARCHAR(80)
);
CREATE INDEX web_push_active_user ON web_push_subscriptions(user_id) WHERE enabled=true;
-- Browser delivery is tracked separately from the existing Expo receipt lifecycle.
ALTER TABLE notifications ADD COLUMN web_push_results JSONB NOT NULL DEFAULT '{}';
