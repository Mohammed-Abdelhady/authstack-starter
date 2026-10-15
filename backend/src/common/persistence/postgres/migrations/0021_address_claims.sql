-- Keep the collision preflight and constraint installation on one user set.
LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  colliding_ids text;
  collision_count bigint;
BEGIN
  WITH collisions AS (
    SELECT lower(btrim(email)) AS address
      FROM users
     WHERE email IS NOT NULL
     GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ), colliding_users AS (
    SELECT id FROM users
     WHERE lower(btrim(email)) IN (SELECT address FROM collisions)
  )
  SELECT string_agg(id::text, ', ' ORDER BY id::text), count(*)
    INTO colliding_ids, collision_count
    FROM colliding_users;

  IF collision_count > 0 THEN
    RAISE EXCEPTION 'Address normalisation collision: % users, ids: %',
      collision_count, colliding_ids;
  END IF;
END $$;

UPDATE users SET email = lower(btrim(email))
 WHERE email IS NOT NULL AND email <> lower(btrim(email));

ALTER TABLE users ADD CONSTRAINT user_email_normalised
  CHECK (email IS NULL OR email = lower(btrim(email)));

CREATE TABLE address_claims (
  address text PRIMARY KEY,
  kind text NOT NULL,
  owner text NOT NULL,
  lapses_at timestamptz NOT NULL,
  CONSTRAINT address_claim_normalised CHECK (address = lower(btrim(address)))
);
