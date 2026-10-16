-- Erasing an account, and the receipts a phone asks about after deleting one.
-- Depends on 0001 and 0005 alone. The sign-in providers' tables are in 0032,
-- which a project without a sign-in provider does not carry.
--
-- No table here has a foreign key to users: each row outlives the account it
-- names for a stated time, listed in docs/reference/account-erasure.md.
-- PostgreSQL does not expire rows by itself. The retention job removes them
-- by purge_after or expires_at, and every read compares those itself.

-- NULL while erasure is off, and for an account deleted before it was on.
ALTER TABLE users ADD COLUMN erase_after timestamptz;

-- When the person last deleted the account themselves, written even while
-- erasure is off. Staff never write it, and a later staff deactivation moves
-- deleted_at away from it, so the schedule command dates own deletions only.
ALTER TABLE users ADD COLUMN self_deleted_at timestamptz;

-- Serves the worker's search for deactivated accounts that are due.
CREATE INDEX user_erase_due ON users (erase_after)
  WHERE is_deleted AND erase_after IS NOT NULL;

-- One job per account being erased. The step says how far it got, so a run
-- that died resumes there. purge_after is set when the account is gone.
CREATE TABLE erasure_jobs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL,
  step text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  failure_code text,
  failed_at timestamptz,
  next_attempt_at timestamptz,
  lease_owner text,
  lease_until timestamptz,
  started_at timestamptz NOT NULL,
  erased_at timestamptz,
  purge_after timestamptz,
  CONSTRAINT erasure_job_user_unique UNIQUE (user_id),
  CONSTRAINT erasure_job_step CHECK (step IN ('erasing', 'hook_done', 'erased')),
  CONSTRAINT erasure_job_attempts_nonnegative CHECK (attempts >= 0)
);

CREATE INDEX erasure_job_purge_after ON erasure_jobs (purge_after);
CREATE INDEX erasure_job_open ON erasure_jobs (started_at DESC)
  WHERE step <> 'erased';

-- The hash of a key the client made before it asked to delete its account,
-- written with the deactivation. Kept 90 days whatever becomes of the account.
CREATE TABLE account_deletion_receipts (
  key_hash text PRIMARY KEY,
  user_id uuid NOT NULL,
  operation text NOT NULL,
  erase_after timestamptz,
  recorded_at timestamptz NOT NULL,
  purge_after timestamptz NOT NULL,
  CONSTRAINT account_deletion_receipt_hash CHECK (key_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX account_deletion_receipt_purge_after
  ON account_deletion_receipts (purge_after);
