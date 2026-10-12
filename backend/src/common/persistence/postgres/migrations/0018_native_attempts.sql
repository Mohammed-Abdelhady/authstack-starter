CREATE TABLE native_attempts (
  id uuid PRIMARY KEY,
  attempt_id text NOT NULL UNIQUE,
  secret_hash text NOT NULL,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  state text NOT NULL,
  requested_scopes text[] NOT NULL,
  flow text NOT NULL,
  phase text NOT NULL,
  auth_epoch integer NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  active_operation_id text,
  cancelled_at timestamptz,
  details jsonb NOT NULL,
  CONSTRAINT native_attempt_secret_hash_sha256 CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT native_attempt_revision_nonnegative CHECK (revision >= 0)
);
CREATE INDEX native_attempts_expires_at_idx ON native_attempts (expires_at);
