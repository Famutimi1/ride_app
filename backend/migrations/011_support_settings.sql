-- Owner-requested support configuration; no invented working contact details.
CREATE TABLE support_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id=true),
  phone TEXT CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$'),
  email TEXT CHECK (email IS NULL OR length(email)<=254),
  staffed_hours TEXT NOT NULL DEFAULT 'Support hours will be announced.',
  availability_message TEXT NOT NULL DEFAULT 'Support contact details are being set up.',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>0),
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO support_settings(id) VALUES(true);
