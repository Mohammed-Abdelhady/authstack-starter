-- The hash of the nonce left with the browser that asked for a sign-in link.
-- It belongs to magic link sign-in, like 0013, and depends on that file only.
-- A link stored before this file has none, and has to be confirmed on screen.

ALTER TABLE pending_magic_links
  ADD COLUMN IF NOT EXISTS request_nonce_hash text;
