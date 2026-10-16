-- Suspending has its own permission. Every role and direct grant that could
-- suspend through the update permission keeps that power.
UPDATE roles
   SET permissions = array_append(permissions, 'users:suspend:all')
 WHERE 'users:update:all' = ANY (permissions)
   AND NOT ('users:suspend:all' = ANY (permissions));

UPDATE roles
   SET permissions = array_append(permissions, 'users:suspend:staff')
 WHERE 'users:update:staff' = ANY (permissions)
   AND NOT ('users:suspend:staff' = ANY (permissions));

UPDATE users
   SET permissions = array_append(permissions, 'users:suspend:all')
 WHERE 'users:update:all' = ANY (permissions)
   AND NOT ('users:suspend:all' = ANY (permissions));

UPDATE users
   SET permissions = array_append(permissions, 'users:suspend:staff')
 WHERE 'users:update:staff' = ANY (permissions)
   AND NOT ('users:suspend:staff' = ANY (permissions));

-- A version on accounts and roles. Any write to a column staff read raises
-- it, whoever makes it. Session bookkeeping columns do not.
ALTER TABLE users ADD COLUMN version integer NOT NULL DEFAULT 0;
ALTER TABLE roles ADD COLUMN version integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION raise_record_version() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;

CREATE TRIGGER user_version
  BEFORE UPDATE OF email, pending_email, name, role, permissions, audience,
    is_deleted, deleted_at, is_verified, password_hash, avatar_url, locale,
    address_generation, auth_provider, primary_provider
  ON users FOR EACH ROW EXECUTE FUNCTION raise_record_version();

CREATE TRIGGER role_version
  BEFORE UPDATE OF name, slug, description, permissions, level, audience,
    is_system_role, is_protected
  ON roles FOR EACH ROW EXECUTE FUNCTION raise_record_version();

-- Staff read an account's linked providers, which live in their own table.
CREATE OR REPLACE FUNCTION raise_linked_account_version() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    UPDATE users SET version = version + 1 WHERE id = OLD.user_id;
  END IF;
  IF TG_OP = 'INSERT' THEN
    UPDATE users SET version = version + 1 WHERE id = NEW.user_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    UPDATE users SET version = version + 1 WHERE id = NEW.user_id;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER user_linked_account_version
  AFTER INSERT OR UPDATE OR DELETE ON user_linked_accounts
  FOR EACH ROW EXECUTE FUNCTION raise_linked_account_version();

-- An invitation holds no account. An enrolment link belongs to one account.
CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  purpose text NOT NULL
    CHECK (purpose IN ('account', 'first_admin', 'enrolment')),
  email text NOT NULL CHECK (email = lower(btrim(email))),
  name text,
  role_id text,
  role_slug text,
  audience text CHECK (audience IS NULL OR audience IN ('customer', 'staff')),
  client_id text NOT NULL,
  invited_by text,
  user_id uuid REFERENCES users (id) ON DELETE CASCADE,
  address_generation integer,
  locale text NOT NULL DEFAULT 'en',
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  purge_after timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT invitation_token_unique UNIQUE (token_hash),
  CONSTRAINT invitation_role_present
    CHECK (purpose = 'enrolment' OR role_slug IS NOT NULL),
  CONSTRAINT invitation_enrolment_account
    CHECK ((purpose = 'enrolment') = (user_id IS NOT NULL)),
  CONSTRAINT invitation_enrolment_generation
    CHECK ((purpose = 'enrolment') = (address_generation IS NOT NULL))
);

CREATE INDEX invitation_open ON invitations (created_at DESC, id DESC)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX invitation_email ON invitations (email);
CREATE INDEX invitation_user ON invitations (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX invitation_purge ON invitations (purge_after);

-- A fresh proof belongs to the session that made it, and ends with it.
CREATE TABLE session_proofs (
  session_id uuid PRIMARY KEY REFERENCES sessions (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  client_id text NOT NULL,
  challenge_kind text CHECK (challenge_kind IN ('passkey', 'email-code')),
  challenge_hash text,
  challenge_expires_at timestamptz,
  challenge_wrong_guesses integer NOT NULL DEFAULT 0,
  proof_kind text CHECK (proof_kind IN ('passkey', 'email-code')),
  proof_rp_id text,
  proof_user_verified boolean NOT NULL DEFAULT false,
  proved_at timestamptz,
  purge_after timestamptz NOT NULL
);

CREATE INDEX session_proof_purge ON session_proofs (purge_after);

-- A staff create's key, written in the create's own transaction.
CREATE TABLE staff_idempotency_keys (
  actor_id text NOT NULL,
  client_id text NOT NULL,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  resource_id text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (actor_id, client_id, operation, idempotency_key)
);

CREATE INDEX staff_idempotency_expiry ON staff_idempotency_keys (expires_at);
