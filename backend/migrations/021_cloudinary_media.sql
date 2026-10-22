-- Ownership stays on existing account/application records. Operations are a
-- durable outbox for interrupted uploads, deferred cleanup and retained originals.
ALTER TABLE users ADD COLUMN avatar_asset jsonb;
ALTER TABLE users ADD COLUMN avatar_revision integer NOT NULL DEFAULT 0 CHECK (avatar_revision >= 0);
ALTER TABLE users ADD COLUMN media_operations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(media_operations)='array');
ALTER TABLE users ADD CONSTRAINT avatar_asset_object CHECK (avatar_asset IS NULL OR jsonb_typeof(avatar_asset)='object');
ALTER TABLE driver_profiles ADD COLUMN document_assets jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(document_assets)='object');
