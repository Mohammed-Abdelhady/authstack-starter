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

The migrations are plain SQL files under `src/common/persistence/postgres/migrations`. You apply them. The server never does.

```
pnpm --filter backend run migration:postgres:up
pnpm --filter backend run migration:postgres:status
```

Both read the same environment the server reads. `up` applies what is pending, in order, each file in its own transaction, and says which files it applied. `status` changes nothing. Both exit with 1 when the database is not at this build afterwards, so a deploy script can test either.

When the server starts it compares the migrations it carries with the ones the database recorded. It refuses to serve when they differ and names the files. Run `up` before the first start and after every upgrade.

`up` refuses a database that holds a migration this build does not carry. It names the files and applies nothing.

Two people can run `up` at once. They take turns, and the second finds nothing left. The second waits at most two minutes for the first. After that it says another session holds the migration lock, applies nothing and exits with 1.

There is no command that rolls a migration back. Restore a backup, or write a new migration that undoes the change.

`0012_retention_indexes.sql` builds four indexes with plain `CREATE INDEX` inside its transaction. Writes to `sessions`, `authorization_transactions`, `native_credentials` and `native_dpop_proof_ids` wait until it commits. On a new database that takes no time. On a database that already holds many sessions, apply it with the server stopped.

Each optional sign-in method that has tables of its own brings a migration file of its own. A project made without that method does not carry the file, so the numbers in the folder can have gaps. The order is the order of the names.

## Expired rows

PostgreSQL has no index that expires rows, so the server runs a retention job every five minutes. It removes rows past their expiry, at most 500 rows a statement and 20 statements a table in one run. What is left waits for the next run. When the statement for one table fails, the job logs the table and goes on to the next.

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

The store contract suites, the API suite and the unit suite run on that server. Nothing here tests a failover, a replica, a pooler or a hosted database.
