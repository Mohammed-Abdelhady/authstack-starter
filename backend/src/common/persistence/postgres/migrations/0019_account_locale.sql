-- The language an account's mail is written in. Accounts made before this
-- migration read the default.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en';
