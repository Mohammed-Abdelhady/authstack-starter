-- What a native code knows about how the person proved who they are, so the
-- session it is exchanged for records it. user_verified: whether the person
-- was verified. A constant default is stored without rewriting the table, and
-- a code approved before this file reads as not verified. authenticated_at:
-- when the approving browser session signed in, which the mobile session
-- takes as its own. It stays null for a code approved in the app, and for one
-- approved before this file, whose session takes its issue time.
ALTER TABLE authorization_transactions
  ADD COLUMN user_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN authenticated_at timestamptz;
