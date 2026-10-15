-- Emailed sign-in codes. A file of its own: it belongs to email-code sign-in,
-- and a project without that feature does not carry it. It depends on no
-- other file. One code per owner and purpose, where the owner is a native
-- attempt, so wrong guesses are counted on that attempt's row and never lock
-- an address or touch another attempt. PostgreSQL does not expire rows by
-- itself, so a row stays after it expires until the retention job removes
-- it, and no statement may read "stored" as "still valid".

CREATE TABLE email_codes (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id text NOT NULL,
  purpose text NOT NULL,
  email text NOT NULL,
  code_hash text NOT NULL,
  wrong_guesses integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  spent_at timestamptz,
  CONSTRAINT email_code_owner_purpose_unique UNIQUE (owner_id, purpose),
  CONSTRAINT email_code_wrong_guesses_nonnegative CHECK (wrong_guesses >= 0)
);

CREATE INDEX email_code_expires_at ON email_codes (expires_at);
