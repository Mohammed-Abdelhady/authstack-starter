Put the host product's PostgreSQL migrations here as plain SQL files.
Names follow `0001_description.sql`, with four digits and lowercase letters, digits or underscores.
The numbers belong to the host product. Use names distinct from the core folder.
If a file was already applied and recorded in `schema_migrations`, move its record with
`pnpm --filter backend run migration:postgres:adopt-host 0001_description.sql` before running `up`.
