-- What validating, listing and ending sessions needs beyond 0001: why a
-- session ended, and the order a session list is read in. It touches sessions
-- only. The account's session version and issuance counter stay the columns
-- 0001 created, and 0005 adds no session column, so this file follows 0005 by
-- number and depends on 0001 alone.

ALTER TABLE sessions
  ADD COLUMN revoked_reason text;

-- A session list reads one account's sessions, most recently used first.
CREATE INDEX session_user_last_used ON sessions (user_id, last_used_at DESC);
