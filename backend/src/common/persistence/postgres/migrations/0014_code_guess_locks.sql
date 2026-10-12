-- Wrong codes sent against one address and purpose, counted across every code
-- the address was mailed, and the lock they lead to. They live on the row that
-- already counts the address's mail, because both are kept by address and
-- purpose and one retention rule removes the row when neither needs it.
-- guess_state_expires_at says until when the four columns mean anything: past
-- it they read as no wrong codes and no earlier lock, row or no row.

ALTER TABLE mail_counters
  ADD COLUMN failed_guesses integer NOT NULL DEFAULT 0,
  ADD COLUMN guess_lock_level integer NOT NULL DEFAULT 0,
  ADD COLUMN guess_locked_until timestamptz,
  ADD COLUMN guess_state_expires_at timestamptz;
