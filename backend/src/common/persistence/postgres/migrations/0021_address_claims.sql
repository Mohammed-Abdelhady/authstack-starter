-- Confirmation locks its code before the account, so take tables in that order.
LOCK TABLE pending_registrations, users IN ACCESS EXCLUSIVE MODE;

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'users'::regclass AND conname = 'user_email_normalised'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT user_email_normalised
      CHECK (email IS NULL OR email = lower(btrim(email)));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS address_claims (
  address text PRIMARY KEY,
  kind text NOT NULL,
  owner text NOT NULL,
  lapses_at timestamptz NOT NULL,
  CONSTRAINT address_claim_normalised CHECK (address = lower(btrim(address)))
);

DO $$
DECLARE
  CLAIM_KIND constant text := 'EMAIL_CHANGE';
  CODE_PURPOSE constant text := 'email-change';
  kept bigint;
  cleared_taken bigint;
  cleared_ambiguous bigint;
  cleared_codeless bigint;
  codes_killed bigint;
  conflicting_claims bigint;
BEGIN
  WITH pending AS MATERIALIZED (
    SELECT id, lower(btrim(pending_email)) AS address, address_generation
      FROM users WHERE pending_email IS NOT NULL
  ), pending_groups AS (
    SELECT address, count(*) AS user_count FROM pending GROUP BY address
  ), codes AS MATERIALIZED (
    SELECT id, lower(btrim(email)) AS address,
           user_id, address_generation, expires_at
      FROM pending_registrations WHERE purpose = CODE_PURPOSE
  ), matches AS (
    SELECT p.address, p.id AS owner, c.id AS code_id, c.expires_at
      FROM pending p JOIN codes c
        ON c.address = p.address AND c.user_id = p.id
       AND c.address_generation = p.address_generation
       AND c.expires_at > now()
  ), plans AS MATERIALIZED (
    SELECT g.address, g.user_count,
           EXISTS (
             SELECT 1 FROM users u
              WHERE lower(btrim(u.email)) = g.address
           ) AS taken,
           count(DISTINCT m.owner) AS candidate_count,
           min(m.owner::text) AS owner, min(m.expires_at) AS expires_at
      FROM pending_groups g LEFT JOIN matches m ON m.address = g.address
     GROUP BY g.address, g.user_count
  ), keepers AS (
    SELECT * FROM plans WHERE NOT taken AND candidate_count = 1
  ), inserted AS (
    INSERT INTO address_claims (address, kind, owner, lapses_at)
    SELECT address, CLAIM_KIND, owner, expires_at FROM keepers
    ON CONFLICT (address) DO NOTHING
    RETURNING address
  ), changed AS (
    UPDATE users u
       SET pending_email = CASE
             WHEN NOT p.taken AND p.candidate_count = 1 AND u.id::text = p.owner
             THEN p.address ELSE NULL END
      FROM pending old JOIN plans p ON p.address = old.address
     WHERE u.id = old.id
       AND u.pending_email IS DISTINCT FROM CASE
             WHEN NOT p.taken AND p.candidate_count = 1 AND u.id::text = p.owner
             THEN p.address ELSE NULL END
    RETURNING u.pending_email IS NULL AS cleared,
              p.taken, p.user_count, p.candidate_count
  ), killed AS (
    -- A keeper preserves every code variant for its folded address.
    DELETE FROM pending_registrations c
     USING codes old, plans p
     WHERE c.id = old.id AND old.address = p.address
       AND (p.taken OR p.candidate_count <> 1)
    RETURNING c.id
  )
  SELECT (SELECT count(*) FROM inserted),
         (SELECT count(*) FROM changed WHERE cleared AND taken),
         (SELECT count(*) FROM changed WHERE cleared AND NOT taken
           AND (user_count > 1 OR candidate_count > 1)),
         (SELECT count(*) FROM changed WHERE cleared AND NOT taken
           AND user_count = 1 AND candidate_count <= 1),
         (SELECT count(*) FROM killed),
         (SELECT count(*) FROM keepers k JOIN address_claims c
            ON c.address = k.address
           WHERE c.owner <> k.owner OR c.kind <> CLAIM_KIND
              OR c.lapses_at <> k.expires_at)
    INTO kept, cleared_taken, cleared_ambiguous,
         cleared_codeless, codes_killed, conflicting_claims;

  IF conflicting_claims > 0 THEN
    RAISE EXCEPTION 'Address backfill conflicts with % existing claims',
      conflicting_claims;
  END IF;
  RAISE NOTICE
    'Address ledger backfill: kept=% cleared_taken=% cleared_ambiguous=% cleared_codeless=% codes_killed=%',
    kept, cleared_taken, cleared_ambiguous, cleared_codeless, codes_killed;
END $$;
