-- Tables browser sign-in needs, and no others. Ids are UUID version 7.

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  is_deleted boolean NOT NULL DEFAULT false,
  session_version integer NOT NULL DEFAULT 0,
  issuance_fence integer NOT NULL DEFAULT 0
);

CREATE TABLE applications (
  client_id text NOT NULL,
  environment text NOT NULL,
  platform text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  session_version integer NOT NULL DEFAULT 0,
  allowed_scopes text[] NOT NULL DEFAULT '{}',
  absolute_lifetime_ms bigint NOT NULL,
  idle_lifetime_ms bigint NOT NULL,
  CONSTRAINT application_client_environment_unique
    PRIMARY KEY (client_id, environment)
);

CREATE TABLE user_application_grants (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users (id),
  client_id text NOT NULL,
  allowed boolean NOT NULL DEFAULT true,
  allowed_scopes text[] NOT NULL DEFAULT '{}',
  session_version integer NOT NULL DEFAULT 0,
  issuance_fence integer NOT NULL DEFAULT 0,
  CONSTRAINT grant_user_client_unique UNIQUE (user_id, client_id)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users (id),
  token_hash bytea NOT NULL,
  csrf_token text,
  user_agent text NOT NULL,
  device jsonb,
  device_name text,
  ip text NOT NULL,
  is_valid boolean NOT NULL DEFAULT true,
  revoked_at timestamptz,
  client_id text NOT NULL,
  user_version integer NOT NULL,
  client_version integer NOT NULL,
  grant_version integer NOT NULL,
  auth_epoch integer NOT NULL,
  schema_version integer NOT NULL,
  scopes text[] NOT NULL,
  audience text NOT NULL,
  authentication_methods text[] NOT NULL,
  credential_purpose text NOT NULL,
  browser_generation integer NOT NULL,
  authenticated_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  CONSTRAINT session_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX session_user_live ON sessions (user_id)
  WHERE is_valid AND revoked_at IS NULL;

CREATE TABLE security_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  event_id text NOT NULL,
  target_user_id text,
  client_id text,
  session_id text,
  action text NOT NULL,
  outcome text NOT NULL,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT security_event_id_unique UNIQUE (event_id)
);
