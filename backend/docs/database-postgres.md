# PostgreSQL

The server stores everything in one PostgreSQL database. This page says what it needs, how to move the schema forward, and what runs in the background.

## What it needs

| Need       | Value                                      | Why                                                                             |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| Version    | PostgreSQL 18 or newer                     | New ids come from the `uuidv7()` function, which the server has from version 18 |
| Topology   | One primary, `synchronous_commit` left on  | A sign-in, a revocation and its security event commit together, and stay stored |
| Connection | A direct one for the migration command     | The command takes a lock that belongs to the database session                   |
| Failover   | The old primary is fenced before a new one | PostgreSQL does not notice by itself that it was replaced                       |

A replica is your choice. An asynchronous replica can lose the last commits in a failover, so a session that was ended on the old primary can come back on the new one.

## Settings

| Setting             | Values                                     | Default        |
| ------------------- | ------------------------------------------ | -------------- |
| `POSTGRES_URL`      | A `postgres://` or `postgresql://` address | None, required |
| `POSTGRES_POOL_MAX` | 1 to 200 connections                       | `10`           |

Set `DATABASE_TYPE=postgres` as well. Without it the server runs on the other database this repository carries. <!-- feature:database-choice -->

```
POSTGRES_URL=postgres://APP_USER:APP_PASSWORD@DATABASE_HOST:5432/DATABASE_NAME
POSTGRES_POOL_MAX=10
```

The server refuses to start when the address is missing or malformed, and the message names the setting.

## Migrations

Core migrations are plain SQL files under `src/common/persistence/postgres/migrations`, recorded in `schema_migrations`. Put the host product's migrations under `src/host/migrations`; they are recorded in `host_migrations`. You apply both sources. The server never does.

Host names follow the same pattern, `0001_description.sql`, with four digits and lowercase letters, digits or underscores. The numbers belong to the host product, so they do not continue the core sequence. A full filename must be distinct from every core filename. Migrations must be regular files; matching directory or symlink names are refused in both folders. A missing host folder or one with no matching SQL files is empty. The build copies both folders' SQL into `dist`.

```
pnpm --filter backend run migration:postgres:up
pnpm --filter backend run migration:postgres:status
```

Both read the same environment the server reads. `up` applies core first under the core lock, releases that lock, then applies host under its own lock. Each source runs in name order, each file in its own transaction. A failed host file rolls back alone; earlier host files and all completed core migrations stay applied. Repair the file and run `up` again to apply what is still pending.

`status` changes nothing. Its existing three core lines come first, followed by three host lines. Both commands exit with 1 when either source differs from this build afterwards, so a deploy script can test either.

When the server starts it compares the migrations it carries with the ones the database recorded. It refuses to serve when either source differs and names the files. Host refusals also identify host migrations. Run `up` before the first start and after every upgrade.

`up` refuses a source whose ledger holds a migration this build does not carry, before applying anything to that source. It names the files and identifies host migrations when they differ. A host refusal can happen after core has completed.

Two people can run `up` at once. They take turns within each source, and a waiting run finds that source's files already applied. Since the core lock is released before host, the runs can split the work between sources. Each lock wait is at most two minutes. After that it names the source whose lock is held and exits with 1. Files committed before that wait remain applied.

A rollback to a build lacking an applied file is refused by `up` and by server start-up. Keep applied files in the build and repair forward with a new migration that undoes the change. There is no command that rolls migrations back.

`0012_retention_indexes.sql` builds four indexes with plain `CREATE INDEX` inside its transaction. Writes to `sessions`, `authorization_transactions`, `native_credentials` and `native_dpop_proof_ids` wait until it commits. On a new database that takes no time. On a database that already holds many sessions, apply it with the server stopped.

Run `0021_address_claims.sql` with writes paused, or rerun the upgrade if PostgreSQL aborts it as a deadlock victim, since the whole migration rolls back and is safe to rerun.

`0023_account_audience.sql` and `0024_session_evidence.sql` add their checks as `NOT VALID`. The new columns hold only empty values or their defaults, which pass, so neither file scans `users`, `roles` or `sessions` while it holds the table lock. New and changed rows are checked as usual. To have PostgreSQL record the checks as validated, run `ALTER TABLE ... VALIDATE CONSTRAINT ...` later; it does not block reads or writes.

Each optional sign-in method that has tables of its own brings a migration file of its own. A project made without that method does not carry the file, so the numbers in the folder can have gaps. The order is the order of the names.

### Adopting existing host records

If your own SQL files were applied through the core folder before the host source existed, move those files to `src/host/migrations` and adopt their records. Give the command explicit filenames. For example, if `0042_orders.sql` was already applied and its row is in `schema_migrations`:

```
pnpm --filter backend run migration:postgres:adopt-host 0042_orders.sql
pnpm --filter backend run migration:postgres:up
pnpm --filter backend run migration:postgres:status
```

Adoption runs no host migration's SQL. It moves the named rows from `schema_migrations` to `host_migrations`, preserving their application dates, in one transaction. It takes the core lock before the host lock, and waits at most two minutes for each. If the host ledger is absent, it creates it using `0020_host_migrations.sql`. In the same transaction, it records 0020 in `schema_migrations` if absent. Older builds that do not carry 0020 then refuse to run migrations. A current build also refuses to apply pending core files already recorded in `host_migrations`; remove adopted files from its core folder.

Every name must be in the host folder and absent from the core build. A row already in the host ledger and absent from core is a no-op, so repeating the command is safe. When nothing moves, adoption takes the locks and reads the ledgers but runs no ledger DDL or transaction. A missing core record or a name in both ledgers refuses the whole batch. No names is a usage error with exit 2. An adoption refusal exits with 1 and moves nothing. Until adoption, unrecognized host records in the core ledger stop the server and `up`; both messages point to `adopt-host` for names in the host folder.

## Expired rows

PostgreSQL has no index that expires rows, so the server runs a retention job every five minutes. It removes rows past their expiry, at most 500 rows a statement and 20 statements a table in one run. What is left waits for the next run. When the statement for one table fails, the job logs the table and goes on to the next. Cleanup is eventual and has no fixed maximum delay.

The job includes temporary address claims at `lapses_at` with no extra retention interval. Migration `0034_address_claim_retention.sql` indexes existing claims for this cleanup. A renewed or replacement row is left alone when cleanup had selected an earlier expired row version. Account addresses remain protected by the users table.

No check of a code, a proof, a token or a session waits for this job. Each one compares the expiry itself, so an expired row the job has not reached yet is refused like one it has removed.

## Health

The health route answers from what the server last saw. It asks the database once before it serves and then every five seconds, on a connection of its own. A look that gets no answer within three seconds counts as unreachable. A server that answers but does not take writes, such as a standby, shows as unhealthy too.

## Time bounds

These are fixed, not settings.

| Bound                                  | Value      |
| -------------------------------------- | ---------- |
| Waiting for a free connection          | 10 s       |
| Statement, cancelled by the database   | 15 s       |
| Statement, given up on by the server   | 20 s       |
| Keep-alive probe on an idle connection | after 10 s |
| One health look                        | 3 s        |
| Stopping a schedule at shutdown        | 5 s        |
| Closing a pool at shutdown             | 5 s        |

A database host that has gone silent holds a shutdown for twenty seconds at the most. The migration command has no statement bound, because building an index takes as long as the table is large.

## Ids

An id is a UUID version 7, 36 characters with hyphens. A route refuses any other form with 400 and `Invalid identifier format`. Nothing in the server reads a time or an order out of an id.

## Tests

```
pnpm --filter backend run test
pnpm --filter backend run test:e2e:postgres
```

Neither needs a database of your own. The `embedded-postgres` development dependency carries a PostgreSQL 18 server for your platform. A suite that needs a database starts one with a data folder of its own under the system temporary folder and removes both when it ends. The API suite starts one server for the whole run, gives each booted application a database copied from a migrated template, and removes all of it when the run ends.

A unit run on its own uses all but one available CPU. When another backend test command is running, a new one uses one worker.

The store contract suites, the API suite and the unit suite run on that server. Nothing here tests a failover, a replica, a pooler or a hosted database.
