-- When a session was stored, which the list of a person's sessions shows.
-- 0001 owns every other session column. The database stamps the row.

ALTER TABLE sessions
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
