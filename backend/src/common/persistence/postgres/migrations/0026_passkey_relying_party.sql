-- The relying party each passkey was registered under, and the session a
-- challenge was handed to. A project without passkeys does not carry this
-- file; it depends only on 0009, which carries the same feature.
--
-- Existing passkeys keep rp_id NULL. Every one of them was made for the web
-- relying party, WEBAUTHN_RP_ID, which the server resolves at start-up (it
-- falls back to the CLIENT_URL host) and this file cannot read. Both stores
-- read NULL as that configured id.
ALTER TABLE passkeys ADD COLUMN IF NOT EXISTS rp_id text;

-- Serves the count and the exclusion list for one relying party.
CREATE INDEX IF NOT EXISTS passkey_owner_relying_party
  ON passkeys (user_id, rp_id);

-- Only the session named here may spend the challenge. NULL for a challenge
-- the browser carries in its signed cookie, which names its session itself.
ALTER TABLE passkey_challenges ADD COLUMN IF NOT EXISTS session_id text;
