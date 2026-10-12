-- What an account carries beyond sign-in, roles and mailed links: its password,
-- profile, deactivation, address generation and linked provider accounts.
-- Builds on the account columns that are already there: 0001 (deactivation
-- flag, session version, issuance fence), 0002 (role, permissions) and 0003
-- (address with its unique rule user_email_unique, name, verification, sign-in
-- provider, primary provider). It adds none of them again. 0004 touches no
-- account column, so the two do not depend on each other.

ALTER TABLE users
  ADD COLUMN password_hash text,
  ADD COLUMN avatar_url text,
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN address_generation integer NOT NULL DEFAULT 0,
  ADD COLUMN profile_synced_at timestamptz,
  ADD COLUMN last_synced_provider text,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX user_created ON users (created_at DESC);

-- The embedded list of linked provider accounts, in the order they were
-- linked. One provider identity belongs to one account.
CREATE TABLE user_linked_accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_id text NOT NULL,
  linked_at timestamptz NOT NULL,
  CONSTRAINT user_linked_identity_unique UNIQUE (provider, provider_id)
);

CREATE INDEX user_linked_account_owner ON user_linked_accounts (user_id, id);
