-- Whether the person was verified when a native code was approved, so the
-- session the code is exchanged for records it. A constant default is stored
-- without rewriting the table, and a code approved before this file reads as
-- not verified.
ALTER TABLE authorization_transactions
  ADD COLUMN user_verified boolean NOT NULL DEFAULT false;
