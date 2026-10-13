# create-authstack-starter

Scaffolds the NestJS + Next.js authentication boilerplate with only the sign-in
methods you pick.

```bash
pnpm dlx create-authstack-starter my-app
```

The CLI copies the boilerplate it ships with, deletes the files, env vars and
docs belonging to the methods you left out, then commits the result and installs
dependencies.

## Usage

```bash
pnpm dlx create-authstack-starter [directory] [options]
```

The directory can be a name or a path. Its last segment becomes the project
directory and the `name` in the generated root `package.json`. The directory
must not exist, or must be empty. With `--yes` and no directory the CLI uses
`my-app`.

| Option             | What it does                                                                         |
| ------------------ | ------------------------------------------------------------------------------------ |
| `-y, --yes`        | Take the defaults and skip the prompts                                               |
| `--features a,b,c` | Use these feature ids and skip the feature prompt                                    |
| `--targets a,b,c`  | Client ids: `web`, `native-expo`. See [Mobile app](docs/config.md#mobile-app)        |
| `--database <id>`  | Database id: `mongodb` (the default) or `postgres`. See [Database](docs/database.md) |
| `--preset <id>`    | Apply a preset: `minimal`, `standard`, `everything`                                  |
| `--config <file>`  | JSON file with the same selection keys                                               |
| `--rules <level>`  | Rules level: `strict` (the default) or `standard`                                    |
| `--locales <list>` | Locale ids; `en` is required, `en,ar` adds Arabic                                    |
| `--no-docker`      | Leave out the Docker files and the commands that run them                            |
| `--no-production`  | Leave out nginx, the production compose file and the production docs                 |
| `--dry-run`        | Print the resolved plan and write nothing                                            |
| `--no-install`     | Skip dependency installation; the lockfile is still updated when pnpm is available   |
| `--no-git`         | Skip `git init` and the first commit                                                 |
| `-v, --version`    | Print the CLI version                                                                |

Without `--yes`, `--features`, `--targets`, `--database`, `--preset` or `--config`
the CLI asks for a directory, the clients, the database and the sign-in methods,
grouped by kind. It needs a terminal for that.

The rules level is asked for in a terminal. Without a terminal and without
`--rules` or a `rules` value in the config file, the level is `strict` and
nothing is asked.

Feature ids: `email-password`, `magic-link`, `totp`, `passkeys`, and the
providers `google`, `github`, `facebook`, `microsoft`, `apple`, `discord`,
`linkedin`, `gitlab`, `x`, `slack`, `twitch`, `oidc`. Picking any provider pulls
in `oauth-core`, which is not offered on its own.

For a fresh database, select a method that can create and sign in to the first account. Passkeys need an existing signed-in account for enrollment; a new Facebook identity needs to be linked in settings from another signed-in method. Projects using an existing database can keep enrolled passkeys and linked Facebook identities. Keep the same passkey RP ID and origin.

```bash
pnpm dlx create-authstack-starter my-app --features email-password,google --no-install
```

### Ids and exit codes

An unknown id, or an id that is not available yet, in `--features`, `--targets`,
`--database`, `--locales`, `--preset` or the config file stops the run with exit
code 2 before anything is written or asked. This replaces the older behaviour
where an unknown `--features` id was skipped with a warning. Other usage errors
(a bad flag value, a missing or invalid config file, a wrong type, an unknown
key) also exit 2. Exit 1 is for a run that failed after scaffolding: a leftover
import, a failed install, a `git init` or first commit that failed when git was
requested, or a lockfile that had to be removed. The summary names the failed
step and its reason, and the closing `Done.` is printed only for a clean run. Exit 3 means the installed package itself is damaged, for
example a missing or malformed identity file or package manifest. Reinstall it
and run again.

### Config file

See [Config file](docs/config.md) for selection keys, precedence and rules validation.

### Presets

- `minimal`: `web`, `email-password`, no options.
- `standard` (the default): `web`, the default features, every option.
- `everything`: every available client, feature and option.

A preset never makes an unavailable id available. Planned targets and options
stay as the manifest defines them. A preset carries no database. The database
is chosen apart from it, see [Database](docs/database.md).

### Dry run

`--dry-run` resolves the selection, prints the summary and exits 0 without
copying, pruning, installing or committing anything.

## Generated instructions

Each project gets an `AGENTS.md` with its code rules, commit types and scopes, check list, and package manager. `CLAUDE.md` points to it. The generated
`.gitignore` tracks both files.

Generated projects use pnpm 12.6.0 with an isolated dependency layout. On Node 22,
run `corepack enable` and `corepack prepare pnpm@12.6.0 --activate`. When pnpm is
available, the installer updates the lockfile before the first commit. Without the
pinned pnpm version, it removes the bundled lockfile, prints `pnpm install` as
the next step and exits 1.

## What the CLI does

1. Copies the bundled `template/` into the target directory and restores the
   file names npm strips from a tarball (`.gitignore`, `pnpm-lock.yaml`).
2. Sets the `name` in the root `package.json`.
3. Deletes the `files` and `docs` of every method, option and client you did
   not pick, plus `core.alwaysRemoveFiles`. Names the mobile app when chosen.
4. Deletes the lines and blocks shared files marked for those methods and
   options, then takes the marker comments off the lines that stay.
5. Removes the env lines those methods own from `backend/.env.example`,
   `.env.docker.example` and `frontend/.env.example`, including the comment
   above a line when it names the method. An env var kept by another selected
   method stays.
6. Drops list items and table rows that link to a deleted doc.
7. Writes `AUTH_FEATURES=<ids>` into `backend/.env.example`.
8. Removes the root scripts that run a deleted file, strips deleted files from
   `node --test` lists, drops dependabot docker entries whose Dockerfile is gone
   and removes the catalogue keys an option owns.
9. Renders `pnpm-workspace.yaml` with only the workspaces that remain, keeping
   overrides and build-script approvals. Formats every file it changed with the generated project's own prettier
   configuration, so a fresh scaffold passes its own lint.
10. Greps the result for imports and scripts that point at deleted files. Any
    hit is printed with `file:line` and the CLI exits 1, leaving the tree in
    place.
11. Runs `pnpm install --lockfile-only` before the first commit. If pnpm is
    unavailable or the update fails, it removes `pnpm-lock.yaml`, reports that
    in the summary and prints `pnpm install` as the next step.
12. Writes `.create-authstack-starter.json` into the project root. It records the
    installer name and version, the pinned package manager, a SHA-256 of the template content the project
    was generated from, and the resolved selection: clients, database,
    features, options and locales. It holds no secrets, no paths and no
    machine names, so keep it committed with the project.
13. Runs `git init` and one commit with the updated lockfile, or without one if
    pnpm could not update it.
14. When installation is requested, runs `pnpm install --frozen-lockfile` after
    the commit. A failed install exits 1 and leaves the scaffold for inspection.

The lockfile-only update runs before git and creates no `node_modules`. Frozen
installation runs after the first commit, so installed husky hooks cannot run
lint-staged over the whole tree during that commit.

`AUTH_FEATURES` records what was picked. What ships is decided by the file list
and the markers; the runtime switches are the `*_ENABLED` variables next to it.

## The manifest

`template.manifest.json` lives at the repository root and is copied next to
`template/` when the package is built. Version 2 maps five dimensions: `targets`
(clients), `shared` modules, `databases`, `options` and `features` (sign-in
methods), plus `presets`. A version 1 file still loads and is read as version 2
with `web`, `mongodb` and no options.

```json
{
  "version": 2,
  "targets": {
    "web": { "label": "Web app (Next.js)", "default": true, "files": [] },
    "native-expo": {
      "label": "Mobile app, Expo (iOS simulator only, Android not verified)",
      "default": false,
      "files": ["mobile/expo/**"],
      "workspaces": ["mobile/expo"],
      "requires": { "shared": ["native-core"], "targets": [] },
      "needsSignInSite": true
    }
  },
  "shared": {
    "native-core": { "files": ["mobile/auth/**"], "workspaces": ["mobile/auth"] }
  },
  "databases": {
    "mongodb": { "label": "MongoDB", "default": true, "files": [], "envVars": ["MONGO_URI"] },
    "postgres": { "label": "PostgreSQL", "default": false, "envVars": ["POSTGRES_URL"] }
  },
  "options": {
    "docker": {
      "label": "Docker files",
      "default": true,
      "files": [
        "docker-compose.yml",
        "backend/Dockerfile",
        "frontend/Dockerfile",
        ".dockerignore",
        ".env.docker.example"
      ],
      "catalogueKeys": []
    },
    "production": {
      "label": "Production nginx and compose",
      "default": true,
      "requires": ["docker"],
      "files": ["nginx/**", "docker-compose.prod.yml", "docs/operations/deployment.md"],
      "catalogueKeys": []
    },
    "locale-ar": {
      "label": "Arabic locale",
      "default": true,
      "files": ["frontend/src/i18n/messages/**/*.ar.json"],
      "catalogueKeys": [
        {
          "path": "frontend/src/i18n/messages/en.json",
          "keys": ["common.switchToArabic"]
        }
      ]
    }
  },
  "presets": {
    "minimal": { "targets": ["web"], "features": ["email-password"], "options": [] },
    "standard": {
      "targets": ["web"],
      "features": "defaults",
      "options": ["docker", "production", "locale-ar"]
    },
    "everything": { "targets": "available", "features": "available", "options": "available" }
  },
  "features": {
    "google": {
      "label": "Google",
      "description": "Sign in with a Google account.",
      "kind": "oauth",
      "default": true,
      "files": ["backend/src/auth/oauth/strategies/google-oauth.strategy.ts"],
      "envVars": ["OAUTH_GOOGLE_CLIENT_ID"],
      "requires": ["oauth-core"],
      "docs": ["docs/setup/setup-google-oauth.md"]
    }
  },
  "core": { "alwaysRemoveFiles": [".hyperflow/**"] }
}
```

| Field           | Meaning                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `label`         | Shown in the prompt                                                                                                          |
| `description`   | The hint next to the label                                                                                                   |
| `kind`          | `credential`, `oauth`, `second-factor`, `passwordless`, or `hidden` for an entry another feature requires; groups the prompt |
| `default`       | Preselected in the prompt and picked by `--yes`                                                                              |
| `files`         | Globs, relative to the project root, for files only this method needs                                                        |
| `envVars`       | Env var names stripped from the examples when the method is dropped                                                          |
| `requires`      | Other feature ids pulled in with this one                                                                                    |
| `docs`          | Markdown files deleted with the method, along with links to them                                                             |
| `catalogueKeys` | For an option: catalogue paths and dotted keys removed when it is off                                                        |
| `status`        | `planned` hides the entry from the prompt and from `--features`; omit it for a working method                                |

A target or shared module owns its `files`, `envFiles` and `workspaces`. They are
removed when it is not part of the plan, and its id is a marker name like a
feature id. `native-expo` keeps `mobile/expo` and the `native-core` packages and
removes `mobile/cli`. Without it, all of `mobile/` goes. The Expo app has run on
an iOS simulator. Android is not verified. `native-cli` stays planned: no native
project is committed for it, see [Mobile app](docs/config.md#mobile-app). A workspace has to sit under its owner's `files`.

`targets`, `databases` and `options` share `label`, `default` and `status`. A
target also has `files`, `workspaces`, `envFiles`, `requires` (with `shared` and
`targets` lists) and `needsSignInSite`. An option has `files`, `requires`,
`docs` and `catalogueKeys`. What a database owns and changes is in
[Database](docs/database.md#what-a-database-owns-in-the-manifest).

A preset says which ids to start from. Each field is a list of ids, `"available"`
for every available id, or `"defaults"` for the manifest defaults.

Globs support `?`, `*` and `**`. A path may not start with `/` or contain `..`.

`status: "planned"` marks an id the manifest knows but the CLI does not offer
yet. A planned id is never prompted and is an error if a flag or the config file
names it. A planned target may list files: it is never chosen, so they are always
removed. Planned databases and options do not list files yet. A planned database or
option still has a fixed state, its `default`. Asking for that same state is
accepted, and asking for the opposite is an error. All three options ship today:
`docker`, `production` and `locale-ar` each list the files they own, and turning
one off removes those files, its markers and its root scripts.

Options own their lines the same way features do: a `// feature:docker` marker,
a markdown `<!-- feature:docker:start -->` block, or a root `package.json`
script that runs Docker. `production` requires `docker`; asking for
`--no-docker` while production is still on is a usage error, not a silent drop.

Turning Arabic off removes the `ar` locale, its catalogues and their tests from
the website and the mobile apps. The `rtl:` utility variants, the direction
provider and the `lint:rtl` direction-safe check stay, because the English UI
still uses them; the option is about the language, not direction support.

A `hidden` feature is never shown, never a default and cannot be requested by
id. It arrives through another feature's `requires`, which is how `oauth-core`
follows any provider.

## Markers

Marker rules, and how to add a method, live in [docs/markers.md](docs/markers.md).

## Maintainer notes

The published package carries the whole boilerplate in `template/`. That
directory is generated, gitignored, and rebuilt from the repository on every
build.

```bash
pnpm --filter create-authstack-starter run build   # sync-template.mjs, then tsdown
pnpm --filter create-authstack-starter run test
pnpm --filter create-authstack-starter run test:combinations:all   # slow, three jobs in CI
npm pack -w packages/create-authstack-starter --dry-run
npm publish -w packages/create-authstack-starter --dry-run
```

`test:combinations` scaffolds one project per feature combination into a temp
directory. It updates each pruned lockfile, verifies a frozen pnpm install with
build scripts enabled, and checks the generated workspaces. All combinations
share an explicit store under the test temp root. A separate warm-store offline
case retains the store and MongoDB binary cache. The shipped lockfile alone
does not make a fresh install work offline.

The full-feature browser suite is maintainer tooling. Generated projects omit `frontend/e2e`, both Playwright configurations and the backend browser/consent helpers. Their frontend package omits the corresponding `test:e2e` scripts. Product unit tests and the disposable backend functional API suite remain available. The source repository retains all browser coverage.

`prebuild` runs `scripts/sync-template.mjs`, which copies the repository into
`template/` while skipping `node_modules`, `.git`, `dist`, `.next`, `out`,
`coverage`, logs, real `.env` files, `packages/`, and maintainer folders
(`.hyperflow`, `.claude`, `openspec`). The same script writes
`template.identity.json` beside `template/`: the SHA-256 of the shipped file
list, contents and executable bits, which every generated project records in
`.create-authstack-starter.json`. Build before publishing; a stale or missing
`template/` produces a package that cannot scaffold anything.

Publish from the package directory after a version bump: `pnpm --filter create-authstack-starter run build`, then `npm publish --access public` from
`packages/create-authstack-starter`.

Supports Node 22.12 through Node 22.x for both the CLI and generated project.
Corepack is not bundled from Node 25. The installer is still packed and published
with npm. Its template carries `_pnpm-lock.yaml`, restored to `pnpm-lock.yaml`
before pruning and installation.

## Add rules to an existing project

Run `create-authstack-starter add rules --rules strict --dry-run` at the project root. Use --yes to confirm.

| Layout at the current directory                                                    | Outcome                                                         |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Root package.json identifies pnpm, no workspaces                                   | Full integration, hooks initially inactive                      |
| Root package.json identifies pnpm, package.json workspaces                         | Full integration plus workspace instruction pointers            |
| Root package.json identifies pnpm or npm, pnpm-workspace.yaml                      | Full integration plus workspace instruction pointers            |
| Root package.json identifies npm, no workspaces                                    | Full integration using that manager, hooks initially inactive   |
| Root package.json identifies npm, package.json workspaces                          | Full integration plus workspace instruction pointers            |
| No packageManager field, exactly one supported manager lockfile                    | Same integration, manager version reported as unpinned          |
| No root package.json, including a nested repository directory without one          | Refused with the reason, rules not active, nothing written      |
| Yarn-only or Bun-only lockfile or packageManager                                   | Refused with the reason, rules not active, nothing written      |
| No manager evidence, conflicting lockfiles, invalid manifest or workspace document | Refused with the reason, rules not active, nothing written      |
| Nested directory inside another Git repository without its own Git root            | Refused to prevent activating hooks in the enclosing repository |

See [Add rules to an existing project](docs/add-rules.md) for supported projects, safety, blockers, dependencies, activation and running it again.
