-- WebAuthn credentials and the challenges handed out for them.
-- The account column is a plain reference, not a foreign key: a passkey
-- outlives its account, and sign-in refuses it.

CREATE TABLE passkeys (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL,
  -- Credential id as base64url.
  credential_id text NOT NULL,
  -- COSE public key exactly as the authenticator produced it.
  public_key bytea NOT NULL,
  -- Signature count, unsigned and 32 bits wide, so past what integer holds.
  counter bigint NOT NULL DEFAULT 0,
  transports text[] NOT NULL DEFAULT '{}',
  device_type text,
  backed_up boolean NOT NULL DEFAULT false,
  name text NOT NULL,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT passkey_credential_unique UNIQUE (credential_id)
);

-- Serves the per-account list and the count on the profile.
CREATE INDEX passkey_owner ON passkeys (user_id, created_at DESC);

-- A WebAuthn challenge the server handed out. Nothing here expires rows: every
-- use compares expires_at, and the store's delete-expired removes what lapsed.
CREATE TABLE passkey_challenges (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  challenge_hash text NOT NULL,
  purpose text NOT NULL,
  user_id uuid,
  expires_at timestamptz NOT NULL,
  CONSTRAINT passkey_challenge_hash_unique UNIQUE (challenge_hash)
);

CREATE INDEX passkey_challenge_expiry ON passkey_challenges (expires_at);
