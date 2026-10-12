# Browser test scopes

| Scope                       | Configuration                   | Backend dependency                                                                                                |
| --------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Anonymous frontend behavior | `playwright.frontend.config.ts` | Method discovery and the public signed-out identity envelope are stubbed. Every other API request fails the test. |
| Application integration     | `playwright.config.ts`          | One owned Mongo/backend worker, deterministic users, real sessions, captured mail and a local consent adapter.    |

The frontend-only suite checks English/Arabic desktop/mobile navigation, empty and malformed input, accessible validation descriptions, keyboard controls, loading/empty method discovery, language/direction and horizontal overflow. It captures page screenshots and browser audit attachments. It does not test account creation, sign-in, reset delivery or backend authorization.

Build the frontend first, then run:

```sh
pnpm --filter frontend run test:e2e --config=playwright.frontend.config.ts
```

The test server serves that build's standalone output and assets on `127.0.0.1:3107`. It refuses to reuse an existing server and receives SIGTERM on teardown. Reports and failure traces go to `output/playwright/` at the repository root. Two workers use separate browser contexts; no shared account or database state exists.

The default runtime is Playwright's bundled Chromium. When the exact bundled runtime is unavailable, an installed Chrome channel can be selected explicitly with `PLAYWRIGHT_CHROMIUM_CHANNEL=chrome`; record the browser version with the results. This does not install or change application dependencies.

Use synthetic process variables for build configuration and the fixture's ephemeral backend state.

Application integration includes sidebar, sessions, roles, reload persistence, registration/activation/signout, password reset, profile editing, user creation/editing/soft deletion, local OAuth and magic links, connection failure recovery and representative automated WCAG A/AA checks. Core lifecycle journeys cover English and Arabic at desktop and mobile sizes. Local OAuth tests exercise the application redirect/callback/session chain; they do not establish external provider protocol conformance. Real provider accounts, delivered mail and hardware remain external limits.

For application integration, build with `NEXT_PUBLIC_API_URL=http://127.0.0.1:5107`, then run `pnpm --filter frontend run test:e2e`. The backend fixture owns port 5107, local consent owns 5108, and Mongo uses an ephemeral port. One worker resets users, roles, sessions, mail and local throttle state between cases. Parent-only IPC controls mail capture, explicit link expiry and temporary API unavailability. No fixture control endpoint is exposed over HTTP.

Each authenticated case signs in through the real local flow after its reset. Saved `storageState` is deliberately not reused: it would refer to sessions removed by the next reset. Run backend API coverage separately with `pnpm --filter backend run test:e2e --runInBand`. No external database or seeded account setup is required.
