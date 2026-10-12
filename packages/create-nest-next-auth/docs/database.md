# Database

A project runs on one database, chosen when it is generated.

| Choice     | What the project gets                                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mongodb`  | The Mongoose adapter, the `migrate-mongo` migrations and commands, a MongoDB replica set service in the compose files, and tests on `mongodb-memory-server`                 |
| `postgres` | The Kysely adapter on `pg`, plain SQL migrations with `migration:up` and `migration:status`, a PostgreSQL 18 service in the compose files, and tests on `embedded-postgres` |

The other database's adapter, migrations, packages, lockfile entries, compose
service, environment variables with their validation, setup script steps and
documentation are removed. No setting chooses a database in a generated
project: it carries one adapter and wires it directly.

PostgreSQL has to be version 18 or newer, because new ids come from its
`uuidv7()` function. A PostgreSQL project carries `embedded-postgres` as a
development dependency: its unit and API suites start a server from it, with a
data folder of their own that they remove, so the documented test commands need
no database installed. The migrations of an optional sign-in method live in a
file of their own, and a project without that method does not carry the file,
its tables, its retention rule or its entries in the table map.

What is tested where:

- Both databases pass the same store contract suites and the same API suite in
  this repository.
- A generated project of either database is installed from an empty folder,
  built, linted, typechecked and run through its unit and API suites by
  `test:combinations:postgres` and `test:combinations:mongodb`, for the feature
  sets listed in those suites.
- A PostgreSQL project loses the service specs that are written against
  Mongoose models. The contract suites and the API suite cover the same
  services on PostgreSQL.
- Not tested on either database here: Docker Compose against a real database
  service, a hosted database, a failover, and upgrading a project that was
  generated earlier.

The two databases answer differently in a few documented places, such as the
form of an id and when an expired row is removed. A PostgreSQL project carries
`backend/docs/database-postgres.md`, and this repository lists every difference
in `backend/docs/persistence-notes.md`.

## How the choice is made

`--database <id>` names it, or a `database` value in the config file. In a
terminal the installer asks. Without a terminal and without either of those,
the project runs on MongoDB and nothing is asked, so a command line written
before there was a choice builds the project it always built.

A preset carries no database.

## What a database owns in the manifest

```json
"databases": {
    "mongodb": {
      "label": "MongoDB",
      "default": true,
      "files": ["backend/src/**/persistence/mongo/**"],
      "envVars": ["MONGO_URI"],
      "packages": ["mongoose"],
      "scripts": ["migration:down"]
    },
    "postgres": {
      "label": "PostgreSQL",
      "default": false,
      "files": ["backend/src/**/persistence/postgres/**"],
      "envVars": ["POSTGRES_URL"],
      "packages": ["pg", "kysely"],
      "renames": { "backend/test/jest-e2e-postgres.json": "backend/test/jest-e2e.json" },
      "rewrites": [
        { "files": ["backend/package.json"], "from": "test:e2e:postgres", "to": "test:e2e" }
      ]
    }
}
```

A database owns what only it needs, and all of it goes when another database is
chosen: `files` and `docs`, `envVars` in the environment examples, `packages`
in every package manifest, `scripts` in the backend manifest, `jsonKeys` (a
file and the key paths in it) and `buildApprovals` in the pnpm workspace file.
Three more lists apply when the database is the chosen one. `renames` gives a
file the plain name the other database left free. `rewrites` replaces a literal
text in the files it names, for a command or a sentence that told the two
databases apart. `envExamples` appends settings to an environment example. A
rewrite whose text is not in the project is skipped, because an option that was
left out can take the text with it. The installer's tests fail when a rewrite
names a text the repository no longer has.

The rewrites are kept in `template.rewrites.json` beside the manifest, keyed by
database id, and are read with it. `scriptRenames` gives a backend command the
plain name the other database left free, and refuses a name that is still
taken. A rule that finds nothing to change is reported in the prune result.
When nothing was left out that could explain it, the installer stops and names
the rules, as it does for a reference to a removed file. That is a project with
every sign-in method, option and client kept, under the strict rules level. The installer's tests fail when one is
reported for a project with everything on.

## How generated projects are tested

`test:combinations:postgres` and `test:combinations:mongodb` each install
projects of one database from their own pruned lockfile into an empty folder,
then typecheck, lint and build them and run their unit and API suites. A
PostgreSQL project runs them on the server
`embedded-postgres` carries. The feature sets are listed in
`test/combinations/databases-postgres.slow.test.ts` and
`test/combinations/databases-mongodb.slow.test.ts`.
