-- Keep audio running while the other participant considers video consent.
ALTER TABLE call_sessions
  ADD COLUMN video_upgrade_by UUID REFERENCES users(id),
  ADD COLUMN video_upgrade_until TIMESTAMPTZ;
