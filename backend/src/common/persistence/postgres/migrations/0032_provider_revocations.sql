-- The refresh tokens a sign-in provider hands out, kept encrypted so a grant
-- can be revoked, the jobs that revoke them, and the tickets of a link started
-- from a mobile app. In a file of its own so a project without a sign-in
-- provider does not carry these tables. Depends on no other file.
--
-- No table here has a foreign key to users: each row outlives the account it
-- names for a stated time, listed in docs/reference/account-erasure.md.
-- PostgreSQL does not expire rows by itself. The retention job removes them
-- by purge_after or expires_at, and every read compares those itself.

-- The newest refresh token a provider gave one identity for one client id,
-- encrypted under PROVIDER_TOKEN_ENCRYPTION_KEY. The identity, not the
-- account, is the key: the token is kept where it is obtained. check_after
-- is when the runner checks that an account links the identity; a token no
-- account claims by then is revoked.
CREATE TABLE provider_tokens (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  provider text NOT NULL,
  subject text NOT NULL,
  client_id text NOT NULL,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  tag text NOT NULL,
  key_id text NOT NULL,
  stored_at timestamptz NOT NULL,
  check_after timestamptz,
  CONSTRAINT provider_token_identity_client_unique
    UNIQUE (provider, subject, client_id)
);

CREATE INDEX provider_token_check_after ON provider_tokens (check_after)
  WHERE check_after IS NOT NULL;

-- A token on its way to the provider's revocation endpoint. The token moves
-- here from provider_tokens in the transaction that erases or unlinks, and
-- is cleared once the provider confirms or staff close the job. Every row
-- goes 30 days after it was written, whatever its state.
CREATE TABLE provider_revocations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  provider text NOT NULL,
  subject text NOT NULL,
  client_id text,
  user_id uuid,
  reason text NOT NULL,
  state text NOT NULL,
  outcome text,
  ciphertext text,
  iv text,
  tag text,
  key_id text,
  attempts integer NOT NULL DEFAULT 0,
  failure_code text,
  flagged_at timestamptz,
  next_attempt_at timestamptz,
  lease_until timestamptz,
  created_at timestamptz NOT NULL,
  settled_at timestamptz,
  purge_after timestamptz NOT NULL,
  CONSTRAINT provider_revocation_reason
    CHECK (reason IN ('erasure', 'unlink', 'unclaimed')),
  CONSTRAINT provider_revocation_state
    CHECK (state IN ('pending', 'revoked', 'closed')),
  CONSTRAINT provider_revocation_attempts_nonnegative CHECK (attempts >= 0),
  CONSTRAINT provider_revocation_token_whole CHECK (
    (ciphertext IS NULL) = (iv IS NULL)
    AND (ciphertext IS NULL) = (tag IS NULL)
    AND (ciphertext IS NULL) = (key_id IS NULL)
  ),
  CONSTRAINT provider_revocation_token_only_pending
    CHECK (state = 'pending' OR ciphertext IS NULL),
  CONSTRAINT provider_revocation_pending_has_token
    CHECK (state <> 'pending' OR (ciphertext IS NOT NULL AND client_id IS NOT NULL))
);

CREATE INDEX provider_revocation_due ON provider_revocations (next_attempt_at)
  WHERE state = 'pending';
CREATE INDEX provider_revocation_flagged ON provider_revocations (flagged_at DESC)
  WHERE flagged_at IS NOT NULL;
CREATE INDEX provider_revocation_purge_after
  ON provider_revocations (purge_after);

-- A provider link a mobile app started: bound to the account, the session and
-- the provider, spent once by the finish.
CREATE TABLE provider_link_tickets (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  ticket_hash text NOT NULL,
  user_id uuid NOT NULL,
  session_id text NOT NULL,
  client_id text NOT NULL,
  provider text NOT NULL,
  nonce_digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  spent_at timestamptz,
  CONSTRAINT provider_link_ticket_hash_unique UNIQUE (ticket_hash)
);

CREATE INDEX provider_link_ticket_owner ON provider_link_tickets (user_id);
CREATE INDEX provider_link_ticket_expires_at
  ON provider_link_tickets (expires_at);
