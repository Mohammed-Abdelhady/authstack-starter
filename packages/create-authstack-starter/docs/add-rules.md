# Add rules to an existing project

The command adds instruction files, checks, hooks and workflows to an existing project.
It shows the exact file contents before writing. It does not activate the hooks.

Run this from the project root:

```sh
node /path/to/authstack-starter/packages/create-authstack-starter/dist/index.js add rules --rules strict --dry-run
```

Strict is the default. Use `--rules standard` for the lighter checks.
Remove `--dry-run` to confirm the plan. Use `--yes` to confirm without a prompt.
The result lists written paths, hooks, dependencies, checks run and skipped work.

## Supported projects

| Layout at the current directory                                                    | Outcome                                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Root package.json identifies pnpm, no workspaces                                   | Full integration; hooks initially inactive                    |
| Root package.json identifies pnpm, package.json workspaces                         | Full integration with workspace instruction pointers          |
| Root package.json identifies pnpm or npm, pnpm-workspace.yaml                      | Full integration with workspace instruction pointers          |
| Root package.json identifies npm, no workspaces                                    | Full integration using that manager; hooks initially inactive |
| Root package.json identifies npm, package.json workspaces                          | Full integration with workspace instruction pointers          |
| No packageManager field, exactly one supported manager lockfile                    | Same integration; manager version reported as unpinned        |
| No root package.json, including a nested repository directory without one          | Refused with the reason; nothing written                      |
| Yarn-only or Bun-only lockfile or packageManager                                   | Refused with the reason; nothing written                      |
| No manager evidence, conflicting lockfiles, invalid manifest or workspace document | Refused with the reason; nothing written                      |
| Nested directory inside another Git repository without its own Git root            | Refused to protect the enclosing repository                   |

Workspace globs support `*`, `**`, `?` and exclusions starting with `!`.
Other glob syntax is refused.
Existing npm projects receive commands for that manager.
This repository and generated projects still require pnpm.
The inventory checker keeps its existing rules and exceptions.
Runtime fixture tests check manager-specific output without adding an npm exemption.

## What it never does

- It never installs project dependencies.
- It never runs project scripts or dependency binaries.
- It never imports or executes project configuration.
- It never puts project content into command arguments or invokes a shell.
- It never changes Git configuration, creates a repository or makes a commit.
- It never asks Git for status, which can execute clean filters during index refresh.
- It never leaves repository environment variables enabled for its Git calls.
- It never leaves Git hooks or file monitoring enabled for its Git calls.
- It never writes through an absolute path, a path outside the project or a symbolic link.
- It never overwrites an existing file, including AGENTS.md.
- It never writes before the whole plan passes inspection and is confirmed.
- It never writes during a dry run.
- It never changes package manifests or lockfiles, or adds a prepare script.
- It never claims project checks ran during inspection or application.

Git is used only to inspect the hooks path, through `/usr/bin/git`.
It does not search the project's executable path for another Git binary.
In a Git project, a missing `/usr/bin/git` stops the command with
`Could not inspect Git repository hooks`, an `ENOENT` reason and exit code 2.
Nothing is written. Restore Git at that path before running again.
A project without its own Git repository does not require Git for inspection.

All new files are reserved exclusively before content is written.
A file that appears after planning blocks application.
Open directory handles prevent replaced parents from redirecting filesystem access.
A write failure rolls back files owned by the command.
Competing entries are preserved. If safe restoration fails, the error gives a recovery path.
Do not edit the project while confirming or applying the plan.
Workspace scanning conservatively refuses symlinks outside ignored dependency and build directories.

## What gets added per level

| File or check                                           | Strict                               | Standard                                              |
| ------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------- |
| AGENTS.md, CLAUDE.md and workspace instruction pointers | Added                                | Added                                                 |
| Shared scanner, policy and supporting files             | Added and used                       | Added; banned-construct and file-length scan inactive |
| Gate list                                               | Scanner plus existing root scripts   | Existing root scripts only                            |
| Pre-commit hook                                         | Scanner and staged formatting        | Staged formatting                                     |
| Commit-message hook and commitlint configuration        | Added                                | Added                                                 |
| Pre-push hook                                           | Scanner and existing quality scripts | Existing quality scripts                              |
| Lint-staged configuration                               | Added                                | Added                                                 |
| Quality workflow                                        | Added                                | Added only when a supported root script exists        |
| Trusted scan workflow                                   | Added                                | Omitted                                               |

Only root scripts `lint`, `typecheck`, `test` and `build` can become project gates.
Missing scripts are listed as not added.
Template-specific dependency inventory and backend suites are omitted.
No lint configuration is changed.

The commitlint configuration checks the commit type and the subject length.
It accepts any scope, because scope names belong to your project.

At strict, the file length ceiling covers matching project folders and the bundled guardrail files.
The plan and `AGENTS.md` list which of your source folders match the policy.
When none match, both say so. Edit `CAPPED_PATH` in `scripts/guardrails/policy.mjs`
to cover your source folders. The bundled guardrail files are still capped.
CI requires GitHub Actions. Merge blocking requires branch protection.

## What blocks it and how to resolve it

Every blocker stops the whole plan before writing.

| Blocker                                                           | Resolution                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Existing .husky or core.hooksPath                                 | Integrate the proposed hooks manually with the existing setup              |
| Existing prepare script                                           | Integrate hooks manually; the command will not replace the script          |
| Lint-staged or commitlint configuration, in files or package.json | Integrate the proposed configuration manually                              |
| Existing AGENTS.md                                                | Keep it and pass `--agents-file AGENTS.rules.md`, or integrate manually    |
| Existing CLAUDE.md or workspace instruction file                  | Integrate the instructions manually                                        |
| Existing workflow with a proposed name, or another proposed file  | Integrate that file manually                                               |
| Unsupported layout or invalid manager/workspace evidence          | Run at a supported project root and correct the reported evidence          |
| Unsafe path or symbolic link                                      | Use a project with regular directories and files at the proposed paths     |
| Project changes after inspection                                  | Inspect the new state and run again                                        |
| Missing system Git in a Git project                               | Restore `/usr/bin/git` and run again                                       |
| Edited, missing or partial prior integration                      | Restore the recorded files or remove the prior integration and its receipt |
| Empty rules receipt with no remaining integration files           | Remove the receipt and run again                                           |

The alternate instruction flag is explicit. It never silently replaces AGENTS.md.
CLAUDE.md and workspace pointers then refer to AGENTS.rules.md.

## The receipt and running it again

`.create-authstack-starter.rules.json` records the level, file paths and content hashes.

Older `.create-nest-next-auth.rules.json` receipts remain readable without migration. If both receipt filenames exist, the command refuses the ambiguous setup. Older answers in `.create-nest-next-auth.json` remain readable; new projects write `.create-authstack-starter.json`.
An unchanged second run says that rules are already present and writes nothing.
Edited or partial prior integrations are refused.
Editing the receipt does not switch levels.

## Changing level

Changing level is not supported while files from the earlier integration remain.
Remove the earlier integration and its receipt before adding rules at another level.

## Platform support

macOS and Linux support the required safe directory-relative filesystem access;
Windows and other platforms are refused because that access is unavailable.

## Dependencies you must add

Add these dependencies yourself. The command never installs them:

| Dependency                      | Version |
| ------------------------------- | ------- |
| husky                           | ^9.1.7  |
| lint-staged                     | ^15.5.2 |
| prettier                        | ^3.9.9  |
| @commitlint/cli                 | ^18.6.1 |
| @commitlint/config-conventional | ^18.6.3 |

After adding them, run the activation command printed in the summary:
`node node_modules/husky/bin.js`.
It includes `git init` when the project has no Git repository.
Hooks remain inactive until you activate them.
