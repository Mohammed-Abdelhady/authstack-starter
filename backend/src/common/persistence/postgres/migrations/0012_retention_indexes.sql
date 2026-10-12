-- PostgreSQL has no TTL index. The retention job removes rows past their
-- expiry in small batches and finds them through these indexes. The tables of
-- 0003, 0004, 0008, 0009 and 0013 carry theirs.
--
-- These are plain CREATE INDEX statements inside this file's transaction.
-- Each one blocks writes to its table until the file commits, so sign-in and
-- refresh wait for as long as the build takes. On a database that already
-- holds many sessions, apply this migration with the server stopped.

CREATE INDEX session_expiry ON sessions (expires_at);

CREATE INDEX authorization_transaction_expiry
  ON authorization_transactions (expires_at);

CREATE INDEX native_credential_expiry ON native_credentials (expires_at);

CREATE INDEX native_dpop_proof_id_expiry
  ON native_dpop_proof_ids (expires_at);
