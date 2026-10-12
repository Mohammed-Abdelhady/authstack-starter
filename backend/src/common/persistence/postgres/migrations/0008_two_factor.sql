-- The second factor of an account and the sign-ins waiting for one.
-- The state is one row per account and one row per recovery code, both gone
-- with the account. Builds on the users table of 0001 and touches no column
-- of it. A project without two-factor does not carry this file, and one that
-- gains it later applies it after higher numbers: it may depend only on files
-- every project carries that are lower in number.

CREATE TABLE user_two_factor (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  -- AES-256-GCM, the three parts in base64, exactly as the service made them.
  secret_ciphertext text,
  secret_iv text,
  secret_tag text,
  confirmed_at timestamptz,
  -- Highest TOTP step already spent.
  last_used_step integer,
  CONSTRAINT user_two_factor_secret_whole CHECK (
    (secret_ciphertext IS NULL) = (secret_iv IS NULL)
    AND (secret_iv IS NULL) = (secret_tag IS NULL)
  )
);

-- One recovery code, in the order the batch was handed out. Only its sha256
-- is kept. A code is spent by setting used_at while it is still null.
CREATE TABLE user_recovery_codes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  hash text NOT NULL,
  used_at timestamptz,
  CONSTRAINT user_recovery_code_unique UNIQUE (user_id, hash)
);

-- A sign-in held for a second factor. Nothing here expires rows: every use
-- compares expires_at, and the store's delete-expired removes what lapsed.
CREATE TABLE two_factor_challenges (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL,
  nonce_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  expires_at timestamptz NOT NULL,
  CONSTRAINT two_factor_challenge_nonce_unique UNIQUE (nonce_hash)
);

CREATE INDEX two_factor_challenge_expiry ON two_factor_challenges (expires_at);
