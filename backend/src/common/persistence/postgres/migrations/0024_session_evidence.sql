-- Existing rows take the defaults, which the check accepts, so it is added
-- NOT VALID: the ALTER does not scan sessions under its lock.
ALTER TABLE sessions
  ADD COLUMN user_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN policy_version integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT session_policy_version_not_negative
    CHECK (policy_version >= 0) NOT VALID;
