# Code quality

Local Husky hooks run format, lint, and hard-ban scans on commit. Unit tests run on push. `.github/workflows/ci.yml` runs quality gates on pull requests to `staging` and `master` and pushes to those branches.

## Hooks

`.husky/pre-commit` runs lint-staged (Prettier and ESLint on staged files), then `scripts/check-hard-bans.mjs --staged` on the final index. Temporary indexes supplied by partial Git commits are preserved, and relative index paths resolve from the Git repository root. A resolved merge checks additions against every parent.

`.husky/commit-msg` runs commitlint, then strips matching tool-attribution lines and exits 0 after rewriting the message. A remaining attribution match is an error.

`.husky/pre-push` runs `node scripts/check-hard-bans.mjs --push --hook "$1" "$2"`, then `pnpm run lint`, `pnpm run typecheck`, and `pnpm test`. The checker is the first process to read Git's ref updates from stdin.

<!-- repository-only:start -->

Playwright frontend e2e and CLI combination tests are outside the hook.
<!-- repository-only:end -->

Install hooks with `pnpm install --frozen-lockfile` (`prepare` runs husky). Confirm they are executable with `ls -la .husky/`.

## Continuous integration

`pnpm run ci` runs the shared entry point, `scripts/ci.mjs`. Gate names, commands and order live in `scripts/ci/gates.json`, including the frozen dependency installation command. The runner prints each gate's name and exit status, stops at the first failure and returns that status. A launch error or a gate that terminates itself returns exit 2. SIGINT and SIGTERM sent to the entry point are forwarded to the running gate and its process group; the runner waits for it to close and returns 130 or 143 without starting another gate.

The quality job invokes `node scripts/ci.mjs --install` for a frozen pnpm install, then `node scripts/ci.mjs --quality`. It runs the full-tree ban scan, package-manager inventory, workspace dependency check, lint, typecheck, unit and config tests, and build. A second job, `Backend API suites`, installs the same way and runs the backend end-to-end tests with `node scripts/ci.mjs --api`. The root lint, typecheck and test scripts recurse through the pnpm workspaces. Node comes from `.nvmrc`; a full-SHA-pinned pnpm setup action installs pnpm 12.6.0 and caches its store against `pnpm-lock.yaml`.

<!-- repository-only:start -->

The repository quality list also runs `pnpm run test:config:all` after the unit tests. Installer combinations run in three more jobs on every matching pull request and push, without a path filter: `--installer`, `--installer-postgres` and `--installer-mongodb`. Every repository file can become a template input, so an incomplete input filter could miss a broken generated project. The local entry point runs these slow suites last. Generated projects omit those jobs, their gates and the repository-only regression suites.
<!-- repository-only:end -->

The ordinary `pull_request` jobs run the PR's own workflow, entry point and policy. They exercise quality gates on the proposed code, but a PR can weaken or replace those gates. A passing ordinary range scan is not proof that the base branch's policy was enforced. The push range job scans `before` to `after` when the former is an ancestor. For a new branch, force push or event missing `before`, it uses the fetched default branch's merge base. If that base is unavailable, unrelated or already at the head, it scans the whole checked-out tree. Deleted refs have no content to scan. Branch pushes are enabled; tag pushes and merge queues are not.

`.github/workflows/trusted-scan.yml` uses `pull_request_target`. Which branch supplies the workflow file cannot be verified offline; GitHub's rule has changed over time. The trusted workflow must exist on the repository's default branch before relying on it. Until then, the scan may not run at all. The first real pull request after promotion must confirm which workflow revision GitHub selects.

<!-- repository-only:start -->

This repository's default branch is `master`, while pull requests normally target `staging`. Promote the trusted workflow to `master` as part of rollout.
<!-- repository-only:end -->

The scanner itself always comes from the checkout of the event's `base.sha`. A base branch without `scripts/ci.mjs` fails closed. The base entry point validates the PR head SHA and base branch ref, then fetches that exact head SHA and the current base branch tip into `refs/ci/pr-head` and `refs/ci/current-base`. The PR head remains a Git object. The workflow does not check it out or run its files. The fetch receives the read-only `github.token` through its environment and supplies a server-scoped authorization header through Git environment configuration for that command only. Credentials are absent from Git argv, and submodule recursion is disabled. It does not persist credentials in Git configuration or print Git output. Git tracing is disabled for that command, including configured trace file destinations. This supports private repositories without executing PR content.

From that base checkout, `node scripts/ci.mjs --range <base.sha> <head.sha> <current-base.sha>` validates all three object IDs before Git runs. It scans from the merge base of the fetched current base tip and event head, so already-merged base additions are not blamed on a PR with a stale event base. It never checks out, imports, installs or executes PR-head files. Editing the PR's policy, entry point, gate list or workflow cannot disable this scan when the trusted workflow runs. It enforces the base policy on final added lines and changed-file lengths, including PRs that change the scanner itself. Intermediate violations removed before that head are outside this range check.

Both workflows use read-only contents permission, no referenced secrets, full commit pins with version comments, and `ubuntu-24.04`. The trusted scan has no dependency install or cache. The ordinary range job also needs no installed dependencies. Superseded PR runs are cancelled. Push runs use a unique run-ID concurrency group, so a later push cannot replace either a running or pending range scan. Only the trusted workflow includes `edited`, so title or description edits rerun its short scan. A stacked pull request retargeted to a matching base gets its quality run on its next push. No job-level skip is used for retarget filtering, because a skipped job satisfies a required check. Range jobs have 10-minute limits. The quality job has a 45-minute limit and the API job a 35-minute limit.

<!-- repository-only:start -->

A retargeted pull request also gets its installer runs on its next push. The installer suite runs as three jobs: `Installer combinations` with a 55-minute limit, `Installer PostgreSQL projects` with 50 and `Installer MongoDB projects` with 80. No runner has timed any job, because GitHub Actions is off for this repository. On a 12-core Mac the quality gates took at most 14 minutes, the API suites 11, and the three installer jobs 17, 15 and 26. Each limit is that time doubled for a 4-vCPU runner, which is an assumption, with half as much again as headroom, rounded up to five minutes. The measurements are written beside each limit in the workflow.
<!-- repository-only:end -->

Package-manager commands and MongoDB environment/cache settings live in `scripts/ci/gates.json`. Installation sets `MONGOMS_DISABLE_POSTINSTALL=1`, deferring the binary download until a test actually needs it. The quality job caches `.mongodb-binaries`; the cache key includes the locked `mongodb-memory-server` package version from `pnpm-lock.yaml`, the configured mongod binary version, runner OS and architecture. `MONGOMS_VERSION` in that data file pins the binary used by the tests. Gate subprocesses receive the absolute download directory.

<!-- repository-only:start -->

The installer job also caches Mongo binaries. The configured download directory is inherited by generated-project tests launched by the installer.
<!-- repository-only:end -->

Dependabot checks pinned GitHub Actions weekly in one group. Verify pins against their tags before updating them:

```bash
git ls-remote https://github.com/actions/checkout 'refs/tags/v4.2.2*'
git ls-remote https://github.com/actions/setup-node 'refs/tags/v4.4.0*'
git ls-remote https://github.com/actions/cache 'refs/tags/v4.2.3*'
git ls-remote https://github.com/pnpm/action-setup 'refs/tags/v6.1.0*'
```

<!-- repository-only:start -->

The repository workflows target `staging` and `master`. `.github/CODEOWNERS` assigns the workflow directory, CI entry point/modules and scanner/policy files to `@Mohammed-Abdelhady`. It also covers the exempt legacy scanner tests, template synchronizer and transformation policy, `.nvmrc`, the root `package.json` and `pnpm-workspace.yaml`.
<!-- repository-only:end -->

Generated workflows also target `main`, the usual initial branch created by `git init`. Generated projects omit CODEOWNERS because their owner is unknown. Add `.github/CODEOWNERS` with your actual owner for `/.github/`, `/scripts/ci.mjs`, `/scripts/ci/`, `/scripts/guardrails/`, `/scripts/check-hard-bans.mjs`, `/.nvmrc` and `/package.json`. Adjust branch filters and protections if your integration branches have other names.

Administrators must configure these hosting-service settings; repository files cannot enforce them:

- Protect `staging` and `master`, and `main` where used. Require pull requests and the `Trusted hard-ban range`, `Hard-ban range`, `Quality gates` and `Backend API suites` checks.
- Ensure the trusted workflow exists on the default branch, and confirm its selected revision on a real pull request.
- Dismiss stale approvals when new commits are pushed and require approval of the most recent push.
- Require Code Owner review for the protected CI and scanner files. Include administrators in the protections, and disallow force pushes and branch deletion.
- Require approval for fork pull request workflows and set the default `GITHUB_TOKEN` permissions to read-only.

A required check name can be shadowed by a PR that adds its own job with that name. Code Owner review of `/.github/` is the barrier against that change; a required name alone does not authenticate the workflow.

An author cannot approve their own pull request. Requiring Code Owner review with one owner and administrators included therefore blocks that owner's changes. Add a second owner or a team to CODEOWNERS, which is the recommended approach. Alternatively, retain one owner and allow that owner to bypass the ruleset requiring review, accepting that their own scanner changes are unreviewed. Branch ruleset bypass covers the ruleset, not just the scanner paths. Keep required checks and the force-push/deletion protections in separate rulesets without that bypass. With one maintainer, the scanner protects against contributors, not against the owner.

<!-- repository-only:start -->

Also require the `Installer combinations`, `Installer PostgreSQL projects` and `Installer MongoDB projects` checks in this repository.
<!-- repository-only:end -->

None of these workflows has run on the hosting service yet. Local YAML parsing, Git fixtures, generated-project checks and gate runs do not verify action downloads, event/retarget scheduling, fork execution, fetch availability, cache restore/save, hosted gate results or the repository settings above. Until the workflows are deployed and those settings are enabled, the checks are not an enforced merge boundary.

## Hard-ban scan

The dependency-free entry is `scripts/check-hard-bans.mjs`. Policy data, token reasons, paths and limits live in `scripts/guardrails/policy.mjs`; scanner and Git helpers live in its `scanner/` and `git/` folders. Staged mode scans added lines in the index. Committed-range mode scans from the base and head's merge base. Existing lines are left alone.

It scans `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.sh` case-insensitively, `package.json`, and `.husky` hook scripts. Markdown is skipped so this guide can name the tokens. Policy data is exempt because it contains banned spellings as data.

<!-- repository-only:start -->

This repository also exempts `scripts/guardrails/scanner/check-hard-bans.test.mjs`, which contains legacy token fixtures.
<!-- repository-only:end -->

Checker logic and other tests are scanned. Source files in directories named `node_modules`, `dist`, `.next`, and `.expo` are skipped only when that directory is a direct child of the repository root or a declared workspace root. Workspace roots come from the root package manifest and present workspace manifests. Both array-form workspaces and object-form `workspaces.packages` are supported. An unreadable or unparseable manifest emits one warning and permits only repository-root exclusions. Projects outside declared workspaces receive no directory-name skip. Nested source directories such as `backend/src/dist/` are scanned. A file named `package.json` is scanned unless its path is protected, including in those skipped directories. `.husky/_/` is skipped.

<!-- repository-only:start -->

A project outside the declared workspaces receives no directory-name skip; for example, `mobile/expo/.expo/` is scanned when `mobile/expo` is not declared. Hand-written native source under `mobile/cli/` is still scanned.
<!-- repository-only:end -->

<!-- feature:native-expo:start -->

Generated Expo output under `mobile/expo/ios/` and `mobile/expo/android/` is skipped, and so is `.expo/` output directly under a declared workspace. Hand-written native source under `mobile/device-key/` is still scanned.
<!-- feature:native-expo:end -->

A hit fails the hook:

- HTML injection: `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`
- Lint and type suppressions: see the complete token list and reasons in `scripts/guardrails/policy.mjs`
- Type silencing: `as any`, `as unknown as`, `satisfies any`
- Gate muting: `--no-verify`, `--no-typecheck`, `--no-eslint`

A test filename (`*.spec.*`, `*.test.*`, `*.e2e-spec.*`, or `*.harness-spec.*`) may name a DOM token only in a complete, trimmed `expect(receiver).not.toContain('<token>')` or `expect(receiver).not.toMatch("<token>")` line. The optional trailing semicolon is allowed. The receiver must contain no banned token and use balanced parentheses; the literal must name one exact DOM token, occurring exactly once on the line. Quoted text and escapes do not affect delimiter balancing. Unquoted semicolons, slashes and template literals in the receiver are refused, so the exception stays conservative without parsing JavaScript expressions. Extra statements, comments and other arguments are refused. A denial that the formatter wraps across three lines is refused.

The token checker does not parse TypeScript types. Every workspace enforces the explicit-type rule through ESLint's TypeScript parser at error severity for both source and tests.

<!-- repository-only:start -->

The config suite expands the root package's declared workspaces and skips absent packages. It checks the inventoried TypeScript files through ESLint's own config and ignore APIs: the file is not ignored, the type rule is an error, and inline configuration is disabled. This covers inventoried files actually present, not hypothetical future paths or undeclared workspaces. The repository test uses filesystem inventory so its Git subprocesses never target this worktree; explicit project checks can use tracked Git inventory. Filesystem inventory excludes paths ignored by Git ignore files, including files that happen to be tracked. A present workspace with no lintable files fails the check. Without Git, an equivalent filesystem inventory respects the scan skip list and applicable ignore files. Paths are relative to the project root, including projects nested in another repository. The read-only Git inventory preserves global configuration, including ownership exceptions.
<!-- repository-only:end -->

Human-maintained files selected by `CAPPED_PATH` must stay at 350 lines or fewer. Covered paths are `backend/src/**`, `backend/test/**`, `backend/scripts/**`, `backend/migrations/**`, `frontend/src/**`, `shared/*/src/**`, and `scripts/**`. JSON, snapshot and CSS files are exempt from the line limit.

<!-- repository-only:start -->

The repository also caps `frontend/e2e/**`, `packages/*/src/**`, `packages/*/test/**`, and `packages/*/scripts/**`.
<!-- repository-only:end -->

<!-- feature:native-core:start -->

The mobile workspaces are capped too: `mobile/*/src/**`, `mobile/*/app/**`, `mobile/*/test/**`, and `mobile/*/conformance/**`.
<!-- feature:native-core:end -->

<!-- repository-only:start -->

This repository caps `backend/src`, `backend/test`, `frontend/src`, `frontend/e2e`, `packages/*/src`, `shared/*/src`, and `mobile/*/(src|app|test|conformance)`.
<!-- repository-only:end -->

Source files remain checked when Git marks them binary or their content includes NUL. Non-source images and gitlinks are excluded from content reads. Other text files under capped directories still receive ceiling checks, except JSON data, Jest snapshots and CSS styles. These three extensions are uncapped because data, recorded output and styles do not have the same implementation ceiling. Non-source content is binary when its first 8000 bytes contain NUL. Source extensions always receive both checks even with NUL.

Mode-only changes to oversized source files are refused because the changed surviving file remains out of policy. CR, LF and CRLF each count as one logical line ending. A pure rename into scan scope from an unscanned, skipped or exempt old path checks every line of the destination. Renames out of a test filename also recheck the denial exceptions.

Known token-scan gaps include identifier escapes, dynamically computed keys, aliasing, shadowed assertion helpers and casts split across lines. Code review owns these cases. Cheap direct spellings of `document.writeln`, optional `document?.write`, and quoted bracket `write` calls are refused. Unknown cast chains also match intervening whitespace or block comments on the same line, one parenthesized receiver and nested angle-bracket casts. UTF-16 source with either byte-order mark is decoded before checking; changed lines in such files use a decoded text diff. Deeper parenthesis combinations, adjacent angle assertions and angle assertions with generic outer types remain outside this token scan. Glued TypeScript suppression descriptions and block ESLint configuration comments with a rule-like name followed by a colon are refused. Ordinary comments about ESLint are allowed. ESLint disables inline configuration in every workspace as a second layer. Dollar-prefixed DOM identifiers and prose false positives retain the existing behavior. The attribution list is unchanged.

## Manual commands

```bash
pnpm run check:bans
node scripts/check-hard-bans.mjs --range <base-commit> <head-commit>
node scripts/check-hard-bans.mjs --all
pnpm run check
pnpm run ci
pnpm run format
pnpm run lint
pnpm run lint:fix
pnpm run typecheck
pnpm test
```

`--range` resolves both commits, finds their merge base and scans added lines from that commit to the head and checks changed-file lengths at the head commit. Missing or unresolvable commits return exit code 2. `--all` scans tracked and unignored current files for local inventory, without following symlinks or opening protected files. A source-target symlink is refused with exit 1 in staged, range, push and full-tree scans. Target filenames containing the Unicode replacement character, including lossy decoding of invalid UTF-8 names, return exit 2 with a quoted path and an instruction to rename the file. A literal replacement character in a valid UTF-8 target filename is also refused because it cannot be distinguished from lossy decoding. Non-target filenames are excluded before validation, and a rename to a supported target name can repair an inherited invalid name in one commit. Git modes restrict scanned paths to the project containing the installed script. Invoke them from that project or its enclosing Git repository; the enclosing repository root still produces project-relative paths. A project with its own nested Git repository must instead be invoked in that repository; selecting the outer repository is an error. Production scanning preserves hook repository variables so linked worktrees and detached Git directories retain their context. Relative index paths resolve from the repository root.

<!-- repository-only:start -->

Test fixtures and policy listing clear repository override variables and specify their working directory.
<!-- repository-only:end -->

The pre-push hook passes Git's stdin, destination name and expanded URL to the checker. Empty hook input emits one observation line and returns 0 from the scan; the remaining hook gates still run. Each update supplies local and remote object IDs; only the local ref expression may contain spaces. The checker visits commits reachable from pushed tips, excluding resolvable supplied remote commits and the destination's tracking refs. An explicit configured name takes precedence; otherwise matching configured fetch/push URLs contribute the union of their tracking refs. URL matching uses the expanded hook URL, removes a trailing slash and `.git` suffix, and canonicalizes native local paths and file URLs. For an unknown destination, only configured trusted remotes contribute tracking exclusions. SCP versus SSH spelling, host case and credential normalization are outside this matching rule. Destination matching never echoes URLs or their credentials in checker errors. No network call is made.

A pushed branch's upstream is trusted only when it is a remote-tracking ref owned by the destination or a name in `guardrails.trustedRemotes`, whose default is `origin`. Set that Git config to comma- or whitespace-separated names, or use repeated `git config --add` values; the union replaces the default. An explicitly empty configuration removes the default trust. Unknown explicitly configured remote names are ignored with one warning per distinct name, without printing the name or a possible credential. An absent implicit origin is quiet. When the effective configured set differs from the default, the checker prints one `trusting guardrails.trustedRemotes <names>` line, using `<none>` for an empty set. The standard `origin/main`, `origin/master` and `origin/staging` tracking candidates use the same allowlist. A trusted remote's symbolic `HEAD` can supply its tracking branch even when the default is named `develop` or `trunk`; missing or broken symbols, local-head targets and untrusted namespaces add no baseline. Missing or dangling `origin/HEAD` adds no baseline. Repair it with `git remote set-head origin -a` before choosing the reviewed commit-ID `guardrails.pushBase` fallback below. The longest configured remote-name prefix owns a tracking ref, so trusting `origin` does not trust a separate remote named `origin/nested`. Local branch tips, including `main`, `master` and `staging`, never establish an implicit hook baseline. Unfetched remote objects are omitted from the exclusions so Git can give its own rejection hint. Deletions and tags targeting trees or blobs need no content scan. New side commits and intermediate violations later removed remain checked; merge results are compared with every parent. Push and committed-range reports include the short commit ID.

`git config guardrails.pushBase <commit-ish>` is an explicit opt-in baseline. It trusts everything reachable from the resolved commit, including existing violations, so use it only when deliberately accepting inherited history; later violations remain checked. When a content update applies this baseline, the checker prints `trusting guardrails.pushBase <shortid>`. Branches and `HEAD` move, so such an opt-in trusts newer local changes as the ref moves; prefer the full commit ID of the inherited history you reviewed. Repository, global and environment Git config scopes remain supported, with the same notice. For those updates, invalid or empty values, revision exclusions or ranges, and tree/blob objects return one generic error without echoing the value. This affects authentic hook history scanning; manual empty-input `--push` keeps its separate range behavior.

For each advertised destination branch, a cached tracking ref that disagrees with its remote object ID from stdin is excluded from trust, including aliases leading to it. A new remote branch with a zero ID does not trust a cached counterpart. When a pushed branch's supplied remote commit is unavailable locally, the checker prints fetch-first advice before hit reports and continues its conservative scan. Other stale tracking refs can still hide commits. A tracking ref forged by hand or a local fetch refspec can receive the same trust as a stale one. Tracking names do not prove server provenance, so the hook is a convenience rather than an enforcement boundary. The trusted PR scan uses hosting-service event IDs and the base branch scanner in a fresh checkout with full history. Stale or forged developer tracking refs cannot exclude those additions, and PR edits cannot change the policy used by that scan. Ordinary PR jobs use PR-controlled code and can be weakened by the PR; push checks use the pushed code. Enforcement still requires the hosting-service protections described above. A first push to an empty destination may check all inherited history when no trusted remote baseline is available. An answers file does not establish trusted provenance. For tag-only history or transfer of reviewed old history to an empty remote, an explicit full commit-ID `guardrails.pushBase` is the deliberate fallback, with the trust warning above. Run `--all` or `--range` separately to inspect the intended content.

For manual `--push` with empty stdin, the checker compares merge bases for the upstream, `origin/HEAD`, local `main`, `master`, `staging`, and their `origin` counterparts. It chooses the base with the fewest commits to HEAD, with a stable object-ID tie break. The current local branch cannot supply its own baseline. Missing, pruned or unrelated upstream candidates fall through to the remaining candidates. If none shares history, a unique reachable root is the manual baseline. This manual fallback omits that root's contents; a CI full-tree `--all` check must cover that limit. Multiple roots are legitimate and are scanned without a baseline. Missing HEAD or unresolvable local objects return exit 2. The CI quality job runs `--all` before the other gates, covering the current tree including root-commit contents.

Git metadata is diffed without path arguments. Content diffs use only eligible changed paths, grouped in bounded literal-path batches, then one blob batch. Every target must have exactly one matching patch entry or the scan returns exit 2. An edited rename whose old filename becomes a directory uses a separate object-ID diff to avoid selecting excluded descendants. This avoids argument-limit failures without reading protected files or known non-source images. The output buffer is bounded at 64 MiB; overflow returns 2 and asks for a smaller change. An operating-system argument/environment limit failure also returns 2 with instructions to reduce inherited environment size or split the change. Excerpts are capped at 240 characters and centered on the reported token. An overlong filesystem path is skipped with one warning; a tracked file deleted on disk is skipped during a full scan. CR line endings count in both reported lines and the ceiling.

`pnpm run check` is the staged ban scan plus lint and typecheck, without tests. `pnpm test` runs workspace unit tests and retained config checks.

<!-- repository-only:start -->

This repository's default config command includes listed root suites and fast `scripts/guardrails/*/*.test.mjs` suites. `pnpm run test:config:all` additionally runs every `scripts/guardrails/*/*.slow.mjs` suite, including real Git histories, hooks and large fixtures. The CI quality job runs that complete command. Generated projects retain the runtime checker and inexpensive config checks, and exclude these regression suites and fixture helpers.
<!-- repository-only:end -->

Workspace lint:

```bash
pnpm --filter backend run lint
pnpm --filter frontend run lint
```

Frontend lint also runs the RTL check. Backend uses TypeScript ESLint with `@typescript-eslint/no-explicit-any` as an error. Frontend uses the same `any` rule.

## Commit messages

Messages follow [Conventional Commits](https://conventionalcommits.org/):

```
<type>(<scope>): <subject>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `revert`.

Choose the scope for the affected workspace or tooling from `commitlint.config.cjs`.

<!-- repository-only:start -->

Scopes: `backend`, `frontend`, `shared`, `mobile`, `packages`, `root`, `docs`, `husky`, `lint-staged`.
<!-- repository-only:end -->

```
feat(backend): add session cookie rotation
```

Do not add `Co-authored-by: Cursor`, `Made-with: Cursor`, `cursoragent@cursor.com`, or `Generated with` plus a model name.

## Tests

Backend unit tests use Jest (`pnpm --filter backend test`). Frontend unit tests use Vitest (`pnpm --filter frontend test`). Backend end-to-end tests use `pnpm --filter backend run test:e2e`. CI runs them outside the local hooks, using mongodb-memory-server in replica set mode without an external database.

<!-- repository-only:start -->

The same backend end-to-end suite runs on PostgreSQL with `pnpm --filter backend run test:e2e:postgres`, on an embedded server it starts and removes itself. CI runs it in the API job right after the MongoDB run, and a red suite on either database fails that job.

Frontend end-to-end tests use Playwright (`pnpm --filter frontend run test:e2e`). They run manually, outside commit and push, and are omitted from generated projects.
<!-- repository-only:end -->

## Troubleshooting

If hooks do not run, run `pnpm run prepare` and check that `.husky/pre-commit` is executable.

If commitlint rejects the message, use `<type>(<scope>): <subject>` with an allowed type and scope.

If ESLint blocks the commit, run `pnpm run lint:fix` and fix what remains. Do not add `eslint-disable` comments.

If typecheck fails on push, run `pnpm run typecheck` and fix the types. Use `unknown` with a narrowing check instead of `any`.

If tests fail on push, run `pnpm test` and fix the failures before pushing again.

If the ban scan fails, remove the token from the added line. Fix the underlying issue instead of silencing the checker.

Prettier lives in `.prettierrc` at the repo root. `eslint-config-prettier` turns off ESLint rules that fight Prettier.

## FAQ

Run `pnpm exec lint-staged` followed by `node scripts/check-hard-bans.mjs --staged` to exercise the commit gate without creating a commit.

`pnpm run lint` reports. `pnpm run lint:fix` applies fixes ESLint can make safely.

Change commit types or scopes in `commitlint.config.cjs`.

## Further reading

- [Husky](https://typicode.github.io/husky/)
- [lint-staged](https://github.com/okonet/lint-staged)
- [commitlint](https://commitlint.js.org/)
- [Conventional Commits](https://www.conventionalcommits.org/)
