ALTER TABLE users ADD COLUMN sign_in_devices jsonb;
ALTER TABLE users ADD COLUMN pending_email_initiator text
  CHECK (pending_email_initiator IN ('self', 'staff'));
