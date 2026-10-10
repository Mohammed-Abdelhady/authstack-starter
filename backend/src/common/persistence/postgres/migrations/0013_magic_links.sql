-- Mailed sign-in links. A file of its own: it belongs to magic link sign-in,
-- and a project without that feature does not carry it. It depends on no
-- other file. PostgreSQL has no TTL index, so a row stays after it expires
-- until the retention job removes it, and no statement may read "stored" as
-- "still valid".

CREATE TABLE pending_magic_links (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  email text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  request_ip text,
  user_agent text,
  redirect text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pending_magic_link_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX pending_magic_link_email_created
  ON pending_magic_links (email, created_at DESC);

CREATE INDEX pending_magic_link_expires_at ON pending_magic_links (expires_at);
