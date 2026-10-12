-- What mobile sign-in stores: requests waiting for a decision and their codes,
-- access and refresh tokens, and device-key proof ids. It follows 0009 and
-- depends on 0001 alone.
--
-- The client type, the redirect addresses and the display name of an
-- application belong to 0007. This file adds the device key of a session.
-- No foreign key leaves these tables.

ALTER TABLE sessions
  ADD COLUMN proof_key_thumbprint text;

CREATE TABLE authorization_transactions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  transaction_id text NOT NULL,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  state text NOT NULL,
  requested_scopes text[] NOT NULL DEFAULT '{}',
  audience text,
  intent text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed boolean NOT NULL DEFAULT false,
  user_id uuid,
  captured_user_version integer,
  captured_client_version integer,
  captured_grant_version integer,
  auth_epoch integer NOT NULL,
  authentication_methods text[] NOT NULL DEFAULT '{}',
  code_hash text,
  code_expires_at timestamptz,
  CONSTRAINT authorization_transaction_id_unique UNIQUE (transaction_id),
  CONSTRAINT authorization_code_hash_unique UNIQUE (code_hash)
);

CREATE TABLE native_credentials (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  token_hash text NOT NULL,
  purpose text NOT NULL,
  session_id uuid NOT NULL,
  client_id text NOT NULL,
  generation integer NOT NULL,
  family_id text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  spent boolean NOT NULL DEFAULT false,
  consumed_at timestamptz,
  revoked_at timestamptz,
  proof_key_thumbprint text,
  first_used_at timestamptz,
  successor_access_hash text,
  successor_refresh_hash text,
  retry_claim_until timestamptz,
  CONSTRAINT native_credential_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX native_credential_session_family
  ON native_credentials (session_id, family_id);

CREATE TABLE native_dpop_proof_ids (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  proof_id_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT native_dpop_proof_id_unique UNIQUE (proof_id_hash)
);
