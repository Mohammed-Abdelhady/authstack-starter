-- Single-use browser proofs, and what the event record needs beyond the
-- columns 0001 and 0002 gave it. Runs after 0002, which adds the role columns.

CREATE TABLE browser_proofs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  proof_id_hash text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  spent boolean NOT NULL DEFAULT false,
  CONSTRAINT browser_proof_id_unique UNIQUE (proof_id_hash)
);

-- PostgreSQL has no TTL index. The store's delete-expired statement reads this.
CREATE INDEX browser_proof_expiry ON browser_proofs (expires_at);

-- Retention is the database's own setting.
ALTER TABLE security_events
  ADD COLUMN request_id text,
  ADD COLUMN purge_after timestamptz NOT NULL
    DEFAULT (now() + interval '90 days');

CREATE INDEX security_event_purge ON security_events (purge_after);

-- An investigation reads one account's events, newest first.
CREATE INDEX security_event_target_time
  ON security_events (target_user_id, occurred_at DESC, id DESC);
