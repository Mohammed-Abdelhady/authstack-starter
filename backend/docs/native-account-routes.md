# Native account routes

See [API routes](api-routes.md) for access terms and the other route groups.

## Native account journeys (`/api/auth/native`)

These JSON routes reject browser cookies and Origin headers. They create no browser
session. Routes containing `:attemptId` require its secret in `X-Native-Attempt`.
Native sessions, the registered application and its selected methods must be enabled.
For an application with `firstParty: true`, a step that would advance to consent returns
the code exchange callback instead. An account outside the application's audience gets
each step's wrong-credential answer.
The application settings and SDK requirements are in [mobile setup](../../docs/setup/setup-mobile-sign-in.md). <!-- feature:native-core -->

| Method | Path                                           | Who may call it | Closed by | What it does                                                                              |
| ------ | ---------------------------------------------- | --------------- | --------- | ----------------------------------------------------------------------------------------- |
| GET    | `/api/auth/native/methods`                     | Public          |           | Lists native capabilities for the supplied `clientId`                                     |
| POST   | `/api/auth/native/attempts`                    | Public          |           | Starts an attempt bound to the client, callback, scopes and S256 PKCE                     |
| GET    | `/api/auth/native/attempts/:attemptId`         | Public          |           | Resumes the attempt and returns its current step                                          |
| POST   | `/api/auth/native/attempts/:attemptId/consent` | Public          |           | Approves the verified account's app grant and returns the existing code exchange callback |
| POST   | `/api/auth/native/attempts/:attemptId/cancel`  | Public          |           | Cancels the attempt and invalidates its unfinished proofs                                 |
| POST   | `/api/auth/native/email-change/confirm`        | Public          |           | Confirms an address change from the app with `clientId`, `email` and `code`               |

The email change route takes no attempt. It confirms a change staff started, for someone who may be signed out, exactly as `POST /api/auth/confirm-email-change` does. The account moves and every session ends with the reason `email_changed`. A code for a change the person asked for is refused with the shared invalid-code error. The `clientId` must have the shape the registry takes and name an enabled public native application, or the answer is `400` or `403` before any code is checked. It is throttled like the public route.

<!-- feature:email-password:start -->

### Native password and account lifecycle

Password sign-in also checks the password feature at runtime. Registration and
recovery return generic email-code steps without revealing whether an address exists.
Activation reports a persisted account separately from a later sign-in failure.
Recovery updates the password and invalidates all sessions without signing in.

| Method | Path                                                    | Who may call it | Closed by               | What it does                                                  |
| ------ | ------------------------------------------------------- | --------------- | ----------------------- | ------------------------------------------------------------- |
| POST   | `/api/auth/native/attempts/:attemptId/password`         | Public          |                         | Verifies password and advances to MFA or consent              |
| POST   | `/api/auth/native/attempts/:attemptId/register`         | Public          | `AUTH_PASSWORD_ENABLED` | Requests the signup email code                                |
| POST   | `/api/auth/native/attempts/:attemptId/activate`         | Public          | `AUTH_PASSWORD_ENABLED` | Spends the matching signup generation and creates the account |
| POST   | `/api/auth/native/attempts/:attemptId/recovery/request` | Public          | `AUTH_PASSWORD_ENABLED` | Requests the password recovery code                           |
| POST   | `/api/auth/native/attempts/:attemptId/recovery/confirm` | Public          | `AUTH_PASSWORD_ENABLED` | Commits the password reset and session invalidation           |

<!-- feature:email-password:end -->
<!-- feature:magic-link:start -->

### Native email links

| Method | Path                                                      | Who may call it | Closed by            | What it does                                            |
| ------ | --------------------------------------------------------- | --------------- | -------------------- | ------------------------------------------------------- |
| POST   | `/api/auth/native/attempts/:attemptId/email-link/request` | Public          | `MAGIC_LINK_ENABLED` | Sends an attempt-bound link to the registered callback  |
| POST   | `/api/auth/native/attempts/:attemptId/email-link/verify`  | Public          | `MAGIC_LINK_ENABLED` | Spends the matching link and advances to MFA or consent |

<!-- feature:magic-link:end -->
<!-- feature:email-code:start -->

### Native email codes

Both routes take the attempt secret in `X-Native-Attempt` and answer as a disabled feature unless `EMAIL_CODE_ENABLED` is on and the application's `signIn.emailCode` is true.

| Method | Path                                                      | Who may call it | Closed by | What it does                                                                                                                                                                                                             |
| ------ | --------------------------------------------------------- | --------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/api/auth/native/attempts/:attemptId/email-code/request` | Public          |           | Mails a code for this attempt, and a link when the application has `emailLink`. Answers as a disabled feature while `EMAIL_CODE_ENABLED` or the application's `signIn.emailCode` is off                                  |
| POST   | `/api/auth/native/attempts/:attemptId/email-code/verify`  | Public          |           | Spends the matching code and advances to MFA or consent. Answers `FORBIDDEN` for a deactivated account's right code, and as a disabled feature while `EMAIL_CODE_ENABLED` or the application's `signIn.emailCode` is off |

<!-- feature:email-code:end -->
<!-- feature:totp:start -->

### Native second factor

This route checks second-factor policy and the current account version at runtime.
Its answer must belong to the current attempt. A consumed recovery code cannot be reused.

| Method | Path                                                 | Who may call it | Closed by | What it does                                               |
| ------ | ---------------------------------------------------- | --------------- | --------- | ---------------------------------------------------------- |
| POST   | `/api/auth/native/attempts/:attemptId/second-factor` | Public          |           | Verifies an eligible second factor and advances to consent |

<!-- feature:totp:end -->
<!-- feature:passkeys:start -->

### Native passkeys

These routes require enabled passkeys and the registered native RP and origin policy.
The assertion and challenge are bound to this attempt rather than a browser cookie.

| Method | Path                                                   | Who may call it | Closed by          | What it does                                                                                                              |
| ------ | ------------------------------------------------------ | --------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/auth/native/attempts/:attemptId/passkey/options` | Public          |                    | Creates the native assertion challenge                                                                                    |
| POST   | `/api/auth/native/attempts/:attemptId/passkey/verify`  | Public          |                    | Verifies the assertion and commits its counter and completed factor                                                       |
| POST   | `/api/auth/native/passkeys/register/options`           | Signed in       | `PASSKEYS_ENABLED` | Returns the options for adding a passkey from the app, for the app's relying party. A session cookie gets `403 FORBIDDEN` |
| POST   | `/api/auth/native/passkeys/register/verify`            | Signed in       | `PASSKEYS_ENABLED` | Stores the new passkey under the app's relying party. A session cookie gets `403 FORBIDDEN`                               |

### Native action proof

A full native access session is required. These routes record a proof for that
session and do not accept a browser session or an enrollment credential.

| Method | Path                             | Who may call it     | Closed by          | What it does                                                                |
| ------ | -------------------------------- | ------------------- | ------------------ | --------------------------------------------------------------------------- |
| POST   | `/api/auth/native/proof/options` | Native access token | `PASSKEYS_ENABLED` | Returns a session-bound native RP challenge with required user verification |
| POST   | `/api/auth/native/proof/verify`  | Native access token | `PASSKEYS_ENABLED` | Verifies a configured native origin and RP and records the same bounded act |

<!-- feature:passkeys:end -->
<!-- feature:oauth-core:start -->

### Native provider proof

Only configured native SDK modes are accepted. System-sheet providers use the
existing OAuth browser flow. The server verifies SDK artifacts before resolving
the account; client-supplied account identity is not accepted.

| Method | Path                                            | Who may call it | Closed by | What it does                                                     |
| ------ | ----------------------------------------------- | --------------- | --------- | ---------------------------------------------------------------- |
| POST   | `/api/auth/native/attempts/:attemptId/provider` | Public          |           | Verifies the configured SDK proof and advances to MFA or consent |

<!-- feature:oauth-core:end -->
