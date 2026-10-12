-- Wrong second factor answers counted on the account, and the lock they earn.
-- Builds on user_two_factor of 0008 and belongs to the same feature: a project
-- without two-factor carries neither file, and one that gains it later applies
-- both, 0008 first. It depends on nothing else.

ALTER TABLE user_two_factor
  -- Wrong answers since the last correct one.
  ADD COLUMN failed_attempts integer NOT NULL DEFAULT 0,
  -- No answer is checked before this instant.
  ADD COLUMN locked_until timestamptz;
