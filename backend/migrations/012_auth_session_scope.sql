-- Existing sessions cannot inherit staff privileges during refresh.
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS session_scope VARCHAR(10)
  NOT NULL DEFAULT 'app' CHECK (session_scope IN ('app', 'staff'));
