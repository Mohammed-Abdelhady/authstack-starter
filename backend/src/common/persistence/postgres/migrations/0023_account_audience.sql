-- The new columns hold only NULL, which every check accepts, so the checks are
-- added NOT VALID: the ALTER does not scan users or roles under its lock.
ALTER TABLE users
  ADD COLUMN audience text,
  ADD CONSTRAINT user_audience_valid
    CHECK (
      audience IS NULL
      OR audience IN ('customer', 'staff')
    ) NOT VALID;

ALTER TABLE roles
  ADD COLUMN audience text,
  ADD CONSTRAINT role_audience_valid
    CHECK (
      audience IS NULL
      OR audience IN ('customer', 'staff')
    ) NOT VALID;
