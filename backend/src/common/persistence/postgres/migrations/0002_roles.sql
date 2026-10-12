-- Roles, the repairs they owe, and the account and event columns a role change
-- writes. Runs after 0001, which creates users and security_events.

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  is_system_role boolean NOT NULL DEFAULT false,
  is_protected boolean NOT NULL DEFAULT false,
  level integer,
  permissions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT role_slug_unique UNIQUE (slug),
  CONSTRAINT role_level_not_negative CHECK (level IS NULL OR level >= 0)
);

CREATE INDEX role_created ON roles (created_at DESC);

-- The embedded list of repairs a role owes, in the order they were recorded.
CREATE TABLE role_pending_sweeps (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_role_id uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  role_id uuid NOT NULL,
  previous_slug text NOT NULL,
  actor_id text NOT NULL,
  sweep_id text
);

CREATE INDEX role_pending_sweep_owner ON role_pending_sweeps (owner_role_id, id);
CREATE INDEX role_pending_sweep_target
  ON role_pending_sweeps (role_id, previous_slug);

-- What a holder of a role carries on the account.
ALTER TABLE users
  ADD COLUMN role text NOT NULL DEFAULT 'user',
  ADD COLUMN permissions text[] NOT NULL DEFAULT '{}';

CREATE INDEX user_role ON users (role);

ALTER TABLE security_events
  ADD COLUMN actor_id text,
  ADD COLUMN reason_code text,
  ADD COLUMN assigned_role_id text,
  ADD COLUMN previous_role_id text,
  ADD COLUMN assignment_session_version integer,
  ADD COLUMN deleted_role_id text,
  ADD COLUMN deleted_role_slug text,
  ADD COLUMN deletion_sweep_id text,
  ADD COLUMN deletion_pending boolean;

CREATE INDEX security_event_target
  ON security_events (target_user_id);
