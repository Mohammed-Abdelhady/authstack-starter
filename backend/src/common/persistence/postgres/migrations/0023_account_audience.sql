ALTER TABLE users
  ADD COLUMN audience text,
  ADD CONSTRAINT user_audience_valid
    CHECK (
      audience IS NULL
      OR audience IN ('customer', 'staff')
    );

ALTER TABLE roles
  ADD COLUMN audience text,
  ADD CONSTRAINT role_audience_valid
    CHECK (
      audience IS NULL
      OR audience IN ('customer', 'staff')
    );
