# Project rules

Follow the architecture and conventions in `openspec/project.md`. The testing
policy in `openspec/project-logging-testing-and-troubleshooting.md` applies to
this repository and takes precedence over generic instructions to add tests.

## Critical tests only

- Keep a test only when it protects a concrete failure with material impact on
  account access, security, persisted data, or the ability to generate and start
  a working project. State the failure it catches before adding it.
- Preserve authentication success and refusal, permissions and cross-account
  isolation, session expiry and revocation, credential replay prevention, and
  destructive or security-sensitive writes. Keep race and outage tests when
  those failures could bypass a control or corrupt persisted state.
- Prefer the cheapest layer that proves the behavior. Use units for important
  decisions, real persistence integration for writes, and E2E for essential
  journeys that need a running application. Keep both only when they catch
  different material failures.
- Do not add tests for routine rendering, copy, styling, component structure,
  trivial getters, framework behavior, or implementation wiring. Routine docs,
  presentation, and refactoring changes do not automatically need new tests.
- Reuse an existing behavioral test before creating another file. Avoid
  exhaustive browser, viewport, locale, and option combinations unless each
  additional case protects a distinct material failure.
- Do not chase coverage percentages or test counts. Remove redundant tests
  after checking retained coverage. Never skip failing critical tests, add
  retries, loosen assertions, or bypass checks to get a green result.
- Run the affected retained tests during development. Before a PR, run lint,
  typecheck, the retained test suite, and build. Run API and browser journeys
  when their flows change. Report actual commands and unavailable checks.

## Working in this repository

- Use pnpm and the Node version in `.nvmrc`.
- Preserve unrelated work. Branch before edits and obtain explicit approval
  before committing.
- Reuse existing modules and library components. Keep changes scoped to the
  requested behavior and follow workspace lint and type rules.
