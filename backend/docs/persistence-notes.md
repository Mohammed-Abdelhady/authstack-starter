# Persistence notes

The server runs on MongoDB or on PostgreSQL. One setting chooses, and it is read once when the server starts. MongoDB is the default, so an installation that sets nothing runs exactly as it did before PostgreSQL existed.

This page is about this repository, which carries both databases. A generated project carries one, and this page is not part of it. A PostgreSQL project gets [PostgreSQL](database-postgres.md) instead.

## What the installer makes of the choice

The installer asks which database a project runs on. MongoDB is the default. It takes the answer from a prompt in a terminal, from `--database`, or from `database` in a config file. Without a terminal and without either, the project runs on MongoDB, so a command line written before there was a choice builds what it always built.

| Choice     | The project keeps                                                                                                                                                                  | The project loses                                                                                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MongoDB    | The Mongoose adapter, `migrate-mongo` and its migrations, the replica set service in the compose files, the Mongoose-based specs                                                   | The PostgreSQL adapter and its migrations, `pg`, `kysely`, `embedded-postgres`, `@types/pg`, the PostgreSQL settings and their validation, the SQL failure mapping in the filter                               |
| PostgreSQL | The Kysely adapter, its SQL migrations as `migration:up` and `migration:status`, a PostgreSQL 18 service in the compose files, its contract suites and the API suite as `test:e2e` | The MongoDB adapter, schemas and model modules, `migrate-mongo` and its migrations, `mongoose`, `mongodb`, `@nestjs/mongoose`, `mongodb-memory-server`, `MONGO_URI`, the specs written against Mongoose models |

Neither project has the `DATABASE_TYPE` setting. A project carries one adapter, each `*-persistence.ts` file names that one, and `forStorage` hands it over without reading the environment. The setting, its validation and the check that modules were wired for the validated value exist only here, where two adapters are carried.

How the installer does it, in `template.manifest.json`:

- A line only one database needs carries `// feature:mongodb` or `// feature:postgres`. A line that only chooses between the two carries `// feature:database-choice` and is removed from every generated project.
- Each database lists the files, docs, packages, backend commands, JSON keys and build approvals it owns. They go when the other database is chosen.
- The chosen database also lists renames and literal rewrites. PostgreSQL uses them to take the plain names: `jest-e2e-postgres.json` becomes `jest-e2e.json`, `test:e2e:postgres` becomes `test:e2e`, and the setup scripts ask for a PostgreSQL address.

A PostgreSQL project needs PostgreSQL 18 or newer, because new ids come from the `uuidv7()` function of the server. Its tests need no database installed: `embedded-postgres` is a development dependency of the project, and each suite starts the server that package carries with a data folder of its own and removes it.

### Optional sign-in methods on PostgreSQL

The tables of an optional method are created by a migration file of their own, and that file belongs to the method in the manifest.

| Method     | Tables                                                            | Migration                                                   |
| ---------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| Two-factor | `user_two_factor`, `user_recovery_codes`, `two_factor_challenges` | `0008_two_factor.sql`                                       |
| Passkeys   | `passkeys`, `passkey_challenges`                                  | `0009_passkeys.sql`                                         |
| Magic link | `pending_magic_links`                                             | `0013_magic_links.sql`, `0015_magic_link_request_nonce.sql` |

A project without the method does not carry the file, the table map entries, the retention rule or the queries that read the tables. The migration list is read from the folder and applied in name order, so a list with gaps is still in order, and the start-up check and `migration:status` compare the same list. `user_linked_accounts` stays in every project, as the linked accounts of a user document do on MongoDB.

`0013_magic_links.sql` holds what `0003_pending_codes.sql` used to create for magic links. The full set of files produces the same schema as before the split. A database that an earlier build of this repository migrated with the old `0003` already has the table and no record of `0013`. The statements in `0013` create only what is missing, so `migration:up` records the file on that database and changes nothing in it. No released project had PostgreSQL before this change.

A feature file can be applied after files that are higher in number, when a project gains the feature later. For that reason `0008`, `0009` and `0013` may depend only on files every project carries that are lower in number, and no file that every project carries may depend on them. `0015` adds a column to the table `0013` creates, so it depends on that file of its own feature and on nothing else.

### What a generated project was run through

The installer's combination suite scaffolds a project, installs it from its own pruned lockfile into an empty folder, typechecks, lints and builds it, and runs its unit suite and its API suite.

| Database   | Sign-in methods                                                     |
| ---------- | ------------------------------------------------------------------- |
| PostgreSQL | Every method                                                        |
| PostgreSQL | The default selection: email and password, Google, GitHub, Facebook |
| PostgreSQL | Email and password only                                             |
| PostgreSQL | Email and password, two-factor, passkeys, GitHub                    |
| PostgreSQL | Magic link, passkeys, Google, without email and password            |
| MongoDB    | The default selection                                               |
| MongoDB    | Every method                                                        |

The other MongoDB combinations are typechecked and linted as before. Not run anywhere: Docker Compose against a real PostgreSQL or MongoDB service, a hosted database, a failover, and an upgrade of a project that was generated earlier.

A project carries only the cases its methods can pass. The shared contract cases of linked accounts and passkeys mark each scenario that needs magic link or a password, so a project without that method does not carry it. A project without email and password does not carry the API specs of registration, activation, password reset and password change, and its other API specs get a signed-in session from the session service, with no sign-in route in between. `test/session/issued-session.e2e-spec.ts` is the spec of that session.

## Choosing the database

| Setting             | Values                                     | Default        | Read when                     |
| ------------------- | ------------------------------------------ | -------------- | ----------------------------- |
| `DATABASE_TYPE`     | `mongodb`, `postgres`                      | `mongodb`      | Always                        |
| `MONGO_URI`         | A `mongodb://` or `mongodb+srv://` address | None, required | `DATABASE_TYPE` is `mongodb`  |
| `POSTGRES_URL`      | A `postgres://` or `postgresql://` address | None, required | `DATABASE_TYPE` is `postgres` |
| `POSTGRES_POOL_MAX` | 1 to 200 connections                       | `10`           | `DATABASE_TYPE` is `postgres` |

A PostgreSQL installation sets these, with its own values in place of the placeholders:

```
DATABASE_TYPE=postgres
POSTGRES_URL=postgres://APP_USER:APP_PASSWORD@DATABASE_HOST:5432/DATABASE_NAME
POSTGRES_POOL_MAX=10
```

The server refuses to start when the setting names an unknown database, or when the address of the chosen database is missing or malformed. The message names the setting. The address of the other database is not read at all.

Each module has one file named `*-persistence.ts` that hands it the chosen adapter. Nothing else in the server knows which database it is on. With MongoDB chosen, no PostgreSQL pool exists and no PostgreSQL job runs. With PostgreSQL chosen, no MongoDB connection is opened.

The server needs PostgreSQL 18 or newer, because new ids come from the `uuidv7()` function of the server.

## Running on PostgreSQL

### Migrations

Core migrations are plain SQL files under `src/common/persistence/postgres/migrations`, recorded in `schema_migrations`. The host product has its own files under `src/host/migrations` and its own `host_migrations` ledger. An operator applies both sources. The server never does. [Adopting existing host records](database-postgres.md#adopting-existing-host-records) explains how to move a host record out of the core ledger without replaying its SQL.

```
pnpm --filter backend run migration:postgres:up
pnpm --filter backend run migration:postgres:status
```

Both read the same environment the server reads. `up` applies core first, releases the core lock, then applies host under its own lock. Files run in name order within each source, each in its own transaction. A failed host file rolls back alone, leaving earlier files and completed core migrations applied. `status` changes nothing and reports both sources, with the three core lines first. Both exit with 1 when the database is not at this build afterwards, so a deploy script can test either.

`up` refuses a source whose ledger holds a migration this build does not carry, before applying anything to that source. It names the files and identifies host migrations when they differ. A host refusal can happen after core has completed. A rollback to a build lacking an applied file is refused by `up` and start-up; keep applied files and repair forward.

Two people can run `up` at once. They take turns within each source, and a waiting run finds that source's files already applied. Since the core lock is released before host, the runs can split the work between sources. Each lock wait is at most two minutes. After that it names the source whose lock is held and exits with 1. Files committed before that wait remain applied. That happens when the other run is still going, or when it was interrupted and its session is still connected.

The command needs a direct connection to PostgreSQL. The lock belongs to the database session, and a pooler in transaction mode gives each statement to another session, so the lock would protect nothing.

`0012_retention_indexes.sql` builds four indexes with plain `CREATE INDEX` inside its transaction. Writes to `sessions`, `authorization_transactions`, `native_credentials` and `native_dpop_proof_ids` wait until it commits. On a new database that takes no time. On a database that already holds many sessions, apply it with the server stopped.

When the server starts it compares both sources with their ledgers. It refuses to serve when either differs and names the source and files.

### Expired rows

MongoDB removes expired rows with TTL indexes. PostgreSQL has none, so the server runs a retention job every five minutes. It removes rows past their expiry from the configured expiry tables, at most 500 rows a statement and 20 statements a table in one run. What is left waits for the next run. A magic link is kept for an hour after it stops working, as on MongoDB, because the hourly request count reads it.

Each table is cleaned by itself. When the statement for one table fails, the job logs the table and goes on to the next.

No check of a code, a proof, a token or a session waits for this job. Each one compares the expiry itself, so an expired row the job has not reached yet is refused like one it has removed.

### Health

The health route answers from what the adapter last saw. On PostgreSQL the server asks the database once before it serves and then every five seconds. A look that gets no answer within three seconds counts as unreachable, and the next look starts on time.

The look has one connection of its own, apart from the application pool. A server whose application connections are all busy still reports a database that is up.

### Time bounds

These are fixed, not settings.

| Bound                                  | Value      | Why                                                                                                                      |
| -------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| Waiting for a free connection          | 10 s       | A request that cannot get a connection in that time is refused instead of queued                                         |
| Statement, cancelled by the database   | 15 s       | Every statement is a keyed read or write or one retention batch and takes milliseconds. This only ends one that is stuck |
| Statement, given up on by the server   | 20 s       | Above the database's own bound, so it only fires when the database host has gone silent                                  |
| Keep-alive probe on an idle connection | after 10 s | A host that dropped off the network is noticed without waiting for the next statement                                    |
| One health look                        | 3 s        | Shorter than the five seconds between looks                                                                              |
| Stopping a schedule                    | 5 s        | Shutdown does not wait longer for a look or a retention statement in flight                                              |
| Closing a pool at shutdown             | 5 s        | The same, for a connection still held by a statement                                                                     |

The migration command has no statement bound, because building an index takes as long as the table is large.

### Stopping

Both schedules stop when the server shuts down. Retention ends its pass after the statement in flight. Each schedule waits at most five seconds for that statement, and each of the two pools waits at most five seconds to close, so a database host that has gone silent holds a shutdown for twenty seconds at the most.

## Tests

Every store has a contract suite that runs the same cases on both databases. The API suite runs on either one:

```
pnpm --filter backend run test:e2e
pnpm --filter backend run test:e2e:postgres
```

In a generated PostgreSQL project the second command is the only one, under the plain name `test:e2e`.

The PostgreSQL run starts one embedded server with a data folder of its own, gives each booted application a database copied from a migrated template, and removes all of it when the run ends.

A suite named `*.mongo.e2e-spec.ts` runs on MongoDB only. The PostgreSQL configuration leaves those files out by that name and by nothing else. [What is tested on MongoDB only](#what-is-tested-on-mongodb-only) lists them and says why.

## Differences between the databases

This part lists the places where the two databases are known to answer differently, so an operator who moves from one to the other knows what to expect. Each difference is a different order of the same requests, a different answer to a request that could not be completed, or a different form of the same value. None of them lets a session exist that should not.

### What an id looks like

An id on MongoDB is 24 hexadecimal digits. An id on PostgreSQL is a UUID version 7, 36 characters with hyphens. Each database refuses the other's form in a route with 400 and `Invalid identifier format`. Nothing in the server reads a time or an order out of an id.

A client that checks the form of an id has to accept the form of the database it talks to. The two cases of the SDK contract suite that check an id's form take the expected form from the database the run is on.

### The message for an id the database itself refuses

Routes check an id before it reaches a store, so this is rare. When a store does refuse one, both databases answer 400 with the code `INVALID_INPUT`. MongoDB's message is the driver's own sentence. PostgreSQL's is `Invalid input`. Only a value PostgreSQL was reading as an id is answered this way. Any other text it cannot read as its type is a fault and is answered 500.

### A replayed refresh token during a rotation

A refresh token that was already used is a replay, and a replay ends the whole token family.

On MongoDB a replay that arrives while a rotation of the same family is still running ends the family, and the rotation then fails.

On PostgreSQL the rotation holds the family until it finishes. The replay cannot get in, it is refused three times, and the caller gets a 503 with the family still alive. The rotation succeeds. A replay sent again afterwards ends the family, as it does on MongoDB.

This was reviewed and accepted as it is. A rotation takes less time than the pause before a rerun, so in practice the rerun gets in and the family ends. If you see a 503 on the token route together with a later `refresh_replayed` revocation for the same session, this is what happened.

### A stale primary after a failover

A fresh authority read on MongoDB is a linearizable read. A primary that has lost its majority cannot answer it, so a session ended on the new primary is never accepted by the old one.

A fresh read on PostgreSQL is one statement sent to the server the application believes is the primary. PostgreSQL does not notice by itself that it has been replaced. The hosting setup must fence the old primary during a failover, so that it stops accepting connections before the new one starts taking writes.

### A lost answer to a commit

When the answer to a commit is lost, the server does not know whether the work was stored.

If the commit had landed, neither database runs the work again.

If the commit had not landed, MongoDB runs the work once. PostgreSQL asks the server whether the transaction committed, learns that it did not, and runs the work again from the start. The stored result is the same on both.

### Blocking a grant for an account that does not exist

MongoDB stores the blocked grant, because nothing ties a grant to an existing account.

PostgreSQL refuses it, because a grant refers to its account by a foreign key.

No request can reach this today. The account id always comes from a signed-in person or from an admin screen that lists existing accounts.

### A mobile sign-in that overlaps switching its application off

Switching an application off advances its version, and every session issued for the older version stops validating.

A code exchange that had already read the application as enabled finishes on both databases. The session it stores carries the older version, so it never validates, and switching the application back on does not revive it.

A code exchange that had started but had not yet read the application sees different things. PostgreSQL reads what is committed at each statement, sees the application switched off, and refuses the exchange. MongoDB reads what was committed when the unit of work began, so it still sees the application enabled and stores a session that is already ended. On both, the authorization code is spent and no usable session exists.

### Where the second of two requests is refused

When two requests change the same account, token family or authorization code at once, both databases let one through and make the other run again.

MongoDB refuses the second request at its first write. PostgreSQL refuses it earlier, at its first read, with a row lock that does not wait. The answers the two callers get are the same.

### What the health check can tell

The health route asks the adapter what it last saw of the store. It does not wait on the database, so it answers at once on both.

The MongoDB driver keeps its own view of the connection. The adapter takes a connected driver as ready, and it cannot tell a member that refuses writes from one that takes them. The connection is opened for the primary with majority writes, so in practice there is no other member to be connected to.

The PostgreSQL adapter has to ask, and it remembers the answer. It tells three things apart: the server answers and takes writes, the server answers but is a standby or a session that may only read, and the server does not answer. The last two both show as unhealthy. Until the adapter has asked once, it reports the store as unreachable. The server asks once before it serves and then every five seconds, and gives up on a look after three, so an answer can be up to eight seconds old.

### What is checked when the server starts

On MongoDB the server builds every index its schemas declare, for every collection it uses, and takes requests only when all of them are in place. An index that is already there is left alone, and one that was dropped is built again. If an index cannot be built, for example because stored documents break a unique rule, the server does not start. Migrations are applied by an operator with `migrate-mongo`. The server has never read the record of applied migrations, so it starts on a database that is behind and does not say so.

A first start on an empty database builds every index and takes about a second. A later start only checks them, which takes a few milliseconds. A start after an upgrade that adds an index to a collection that already holds data waits for that index to be built, and the wait grows with the collection.

On PostgreSQL the indexes and unique rules are part of the migrations. The server compares the migrations it carries with the ones recorded in the database and refuses to start when they differ. The message names the migrations to apply, or the ones the database holds that this build does not carry. The server never applies a migration itself.

### How expired rows leave

MongoDB TTL and the bounded PostgreSQL retention job remove expired rows eventually. Neither establishes a fixed maximum deletion time. A backlog or unavailable cleanup can delay physical deletion. The row is refused from the moment it expires on both.

Address claims are temporary reservations. Both adapters remove dated claims after `lapsesAt`, with no additional retention interval. Mongo migration `20261017000001-address-claim-expiry.js` and PostgreSQL migration `0034_address_claim_retention.sql` add the expiry indexes to existing storage. Resend can recreate a removed invitation claim; a renewed or replacement live claim keeps its new expiry. Account insertion releases its transaction-scoped `ACCOUNT` reservation before commit. Removing claims never removes accounts or their email uniqueness. Legacy Mongo claims with no dated expiry need explicit repair because TTL cannot infer a deadline.

### What is tested on MongoDB only

Six suites of the API run are named `*.mongo.e2e-spec.ts` and are not run on PostgreSQL.

The three suites under `test/migrations` drive `migrate-mongo` against a MongoDB server and assert MongoDB indexes and documents. They hold twelve cases. Five of them have a PostgreSQL counterpart in `postgres-migrate.postgres.integration.spec.ts`: applying to an empty database, applying twice, and a migration that fails part way and leaves nothing behind. The other seven have none. Five test rolling a migration back, and the PostgreSQL command has no roll-back. Two test a migration that rewrites stored data, and no PostgreSQL migration does that yet. When one does, it needs a test of its own.

`activation-contract-legacy` and `registration-limits-legacy` under `test/auth` hold three cases about pending registrations stored before a record carried a purpose: one is never honoured as a code, one is dropped when its address signs up again, and one is left alone. Only a MongoDB install can hold such a record. On PostgreSQL the `purpose` column of `pending_registrations` is required and the table was created with it, so the state these cases start from cannot exist there.

`app.startup-indexes` under `test/app` holds two cases: when MongoDB start-up has prepared the store, every index a registered Mongoose model declares is built, and the models of every module were registered by then. On PostgreSQL the indexes and unique rules are created by the migrations and the server builds none, so the guarantee there is that the server does not serve on a database whose migrations differ from the ones it carries. That is tested by the start-up contract, `storage-startup.contract.postgres.integration.spec.ts`: a database at this build is prepared with its unique rules in force, a database that is behind is refused with the names of what to apply, a database that is ahead is refused, and a database nothing was applied to is refused with every migration in order. `postgres-migrate.postgres.integration.spec.ts` adds the case of a server that refused to start and serves once the pending migrations are applied.
