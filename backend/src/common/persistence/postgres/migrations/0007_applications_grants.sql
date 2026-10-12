-- What the application registry stores beyond what sign-in reads in 0001: the
-- fields reconciliation at start writes. It touches applications only. Grants
-- keep the columns and the unique rule 0001 gave them.

ALTER TABLE applications
  ADD COLUMN display_name text NOT NULL,
  ADD COLUMN client_type text NOT NULL,
  ADD COLUMN redirect_uris text[] NOT NULL DEFAULT '{}',
  ADD COLUMN allowed_origins text[] NOT NULL DEFAULT '{}',
  ADD COLUMN audiences text[] NOT NULL DEFAULT '{}',
  ADD COLUMN policy_version integer NOT NULL DEFAULT 0,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
