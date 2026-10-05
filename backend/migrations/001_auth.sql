CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE TYPE user_role AS ENUM ('user', 'admin', 'super_admin'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE driver_application_status AS ENUM ('none', 'pending', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE otp_purpose AS ENUM ('registration', 'login', 'phone_change'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(120) NOT NULL,
  phone VARCHAR(20) UNIQUE,
  phone_verified_at TIMESTAMPTZ,
  email VARCHAR(160) UNIQUE,
  google_id VARCHAR(64) UNIQUE,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  role user_role NOT NULL DEFAULT 'user',
  active_role VARCHAR(10) NOT NULL DEFAULT 'rider' CHECK (active_role IN ('rider', 'driver')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS driver_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  status driver_application_status NOT NULL DEFAULT 'none',
  residential_address TEXT,
  vehicle_make VARCHAR(60), vehicle_model VARCHAR(60), vehicle_year INT,
  vehicle_color VARCHAR(30), plate_number VARCHAR(20),
  license_doc_url TEXT, vehicle_reg_doc_url TEXT, insurance_doc_url TEXT,
  rejection_reason TEXT, submitted_at TIMESTAMPTZ, reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), phone VARCHAR(20) NOT NULL,
  code_hash VARCHAR(255) NOT NULL, purpose otp_purpose NOT NULL,
  attempts INT NOT NULL DEFAULT 0, max_attempts INT NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_phone_purpose ON otp_codes(phone, purpose);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL, device_info VARCHAR(255),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ, replaced_by UUID REFERENCES refresh_tokens(id)
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_token_hash ON refresh_tokens(token_hash);
