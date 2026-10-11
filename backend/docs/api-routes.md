# API routes

Every route the backend serves. All of them sit under `/api`, except `/health`.

How to read the tables:

- **Public** needs no sign-in.
- **Signed in** needs the session cookie, or the access token of a mobile app.
- A permission such as `users:read:all` means signed in and holding that permission, through the role or directly. `*` holds every permission.
- **Closed by** names the setting that turns the route off. With that setting `false` the route answers `404` with the error code `FEATURE_DISABLED`.

## Server

| Method | Path      | Who may call it | Closed by | What it does                                 |
| ------ | --------- | --------------- | --------- | -------------------------------------------- |
| GET    | `/health` | Public          |           | Reports whether the server and database work |
| GET    | `/api`    | Public          |           | Answers with a short text, as a liveness URL |

## Sign-in and account (`/api/auth`)

| Method | Path                             | Who may call it | Closed by               | What it does                                                             |
| ------ | -------------------------------- | --------------- | ----------------------- | ------------------------------------------------------------------------ |
| GET    | `/api/auth/methods`              | Public          |                         | Lists the sign-in methods this server has turned on                      |
| GET    | `/api/auth/browser-proof`        | Public          |                         | Issues the short-lived proof a browser sends before it has a session     |
| GET    | `/api/auth/csrf`                 | Signed in       |                         | Returns the CSRF secret of the current session                           |
| POST   | `/api/auth/register`             | Public          | `AUTH_PASSWORD_ENABLED` | Starts a sign-up and mails a 6-digit code                                |
| POST   | `/api/auth/activate`             | Public          | `AUTH_PASSWORD_ENABLED` | Finishes the sign-up with the code, a name and a password                |
| POST   | `/api/auth/resend-activation`    | Public          | `AUTH_PASSWORD_ENABLED` | Mails a new sign-up code                                                 |
| POST   | `/api/auth/login`                | Public          | `AUTH_PASSWORD_ENABLED` | Signs in with email and password                                         |
| POST   | `/api/auth/forgot-password`      | Public          | `AUTH_PASSWORD_ENABLED` | Mails a 6-digit password reset code                                      |
| POST   | `/api/auth/reset-password`       | Public          | `AUTH_PASSWORD_ENABLED` | Sets a new password with the reset code                                  |
| POST   | `/api/auth/confirm-email-change` | Public          |                         | Confirms the new address after an administrator changed an account email |
| POST   | `/api/auth/logout`               | Signed in       |                         | Ends the current session and clears its cookie                           |

With `AUTH_PASSWORD_ENABLED=false`, `activate` and `resend-activation` answer `404` along with the other password routes, and so does `POST /api/user/password` further down.

<!-- feature:magic-link:start -->

## Magic link (`/api/auth/magic-link`)

| Method | Path                           | Who may call it | Closed by            | What it does                                                          |
| ------ | ------------------------------ | --------------- | -------------------- | --------------------------------------------------------------------- |
| POST   | `/api/auth/magic-link/request` | Public          | `MAGIC_LINK_ENABLED` | Mails a one-time sign-in link. The reply never says if it did         |
| POST   | `/api/auth/magic-link/verify`  | Public          | `MAGIC_LINK_ENABLED` | Spends the link's token, sets the session cookie, returns the account |

<!-- feature:magic-link:end -->
<!-- feature:totp:start -->

## Two-step verification (`/api/auth/2fa`)

| Method | Path                                      | Who may call it | Closed by            | What it does                                                              |
| ------ | ----------------------------------------- | --------------- | -------------------- | ------------------------------------------------------------------------- |
| POST   | `/api/auth/2fa/setup`                     | Signed in       | `TWO_FACTOR_ENABLED` | Stores a pending secret and returns the address for the QR code           |
| POST   | `/api/auth/2fa/confirm`                   | Signed in       | `TWO_FACTOR_ENABLED` | Checks a first code, turns the second step on, returns the recovery codes |
| POST   | `/api/auth/2fa/disable`                   | Signed in       | `TWO_FACTOR_ENABLED` | Turns the second step off                                                 |
| POST   | `/api/auth/2fa/recovery-codes/regenerate` | Signed in       | `TWO_FACTOR_ENABLED` | Replaces the ten recovery codes                                           |
| POST   | `/api/auth/2fa/verify`                    | Public          | `TWO_FACTOR_ENABLED` | Finishes a sign-in that is waiting for its second step                    |

`verify` is public because the person has no session yet. It reads the challenge cookie the first step left.

<!-- feature:totp:end -->
<!-- feature:passkeys:start -->

## Passkeys (`/api/auth/passkeys`)

| Method | Path                                  | Who may call it | Closed by          | What it does                                    |
| ------ | ------------------------------------- | --------------- | ------------------ | ----------------------------------------------- |
| POST   | `/api/auth/passkeys/login/options`    | Public          | `PASSKEYS_ENABLED` | Returns the options for a passkey sign-in       |
| POST   | `/api/auth/passkeys/login/verify`     | Public          | `PASSKEYS_ENABLED` | Signs in with a passkey                         |
| POST   | `/api/auth/passkeys/register/options` | Signed in       | `PASSKEYS_ENABLED` | Returns the options for adding a passkey        |
| POST   | `/api/auth/passkeys/register/verify`  | Signed in       | `PASSKEYS_ENABLED` | Stores the new passkey                          |
| GET    | `/api/auth/passkeys`                  | Signed in       | `PASSKEYS_ENABLED` | Lists the passkeys on the account, newest first |
| PATCH  | `/api/auth/passkeys/:id`              | Signed in       | `PASSKEYS_ENABLED` | Renames a passkey                               |
| DELETE | `/api/auth/passkeys/:id`              | Signed in       | `PASSKEYS_ENABLED` | Removes a passkey                               |

<!-- feature:passkeys:end -->
<!-- feature:oauth-core:start -->

## Sign-in with a provider (`/api/auth/oauth`)

| Method | Path                                 | Who may call it | Closed by | What it does                                                      |
| ------ | ------------------------------------ | --------------- | --------- | ----------------------------------------------------------------- |
| GET    | `/api/auth/oauth/providers`          | Public          |           | Lists the providers that have credentials configured              |
| GET    | `/api/auth/oauth/:provider/start`    | Public          |           | Redirects the browser to the provider                             |
| GET    | `/api/auth/oauth/:provider/callback` | Public          |           | Receives the provider's answer, signs in, redirects to the client |
| POST   | `/api/auth/oauth/:provider/callback` | Public          |           | The same callback for providers that post a form, such as Apple   |
| POST   | `/api/auth/oauth/callback`           | Public          |           | Removed. Always answers `410`                                     |

<!-- feature:oauth-core:end -->

## Own profile and sessions (`/api/user`)

| Method | Path                               | Who may call it | Closed by               | What it does                                       |
| ------ | ---------------------------------- | --------------- | ----------------------- | -------------------------------------------------- |
| GET    | `/api/user/profile`                | Signed in       |                         | Returns the signed-in account                      |
| PATCH  | `/api/user/profile`                | Signed in       |                         | Updates the profile                                |
| POST   | `/api/user/password`               | Signed in       | `AUTH_PASSWORD_ENABLED` | Changes the password, given the current one        |
| DELETE | `/api/user/account`                | Signed in       |                         | Deactivates the own account and ends its sessions  |
| GET    | `/api/user/sessions`               | Signed in       |                         | Lists the active sessions of the account           |
| DELETE | `/api/user/sessions/:sessionId`    | Signed in       |                         | Ends one other session. It refuses the current one |
| POST   | `/api/user/sessions/revoke-others` | Signed in       |                         | Ends every session except the current one          |

<!-- feature:oauth-core:start -->

## Linked providers (`/api/user`)

| Method | Path                                  | Who may call it | Closed by | What it does                                           |
| ------ | ------------------------------------- | --------------- | --------- | ------------------------------------------------------ |
| GET    | `/api/user/linked-providers`          | Signed in       |           | Lists the sign-in methods on the account               |
| DELETE | `/api/user/unlink-provider/:provider` | Signed in       |           | Unlinks a provider from the account                    |
| POST   | `/api/user/set-primary-provider`      | Signed in       |           | Chooses the provider the profile is synced from        |
| GET    | `/api/user/sync-status`               | Signed in       |           | Returns the last profile sync and the primary provider |
| POST   | `/api/user/sync-profile`              | Signed in       |           | Syncs the profile from the primary provider now        |
| POST   | `/api/user/link-provider`             | Signed in       |           | Removed. Always answers `410`                          |

To link a provider, send the signed-in browser to `GET /api/auth/oauth/:provider/start`.

<!-- feature:oauth-core:end -->

## Roles (`/api/roles`)

| Method | Path                   | Who may call it    | Closed by | What it does                                 |
| ------ | ---------------------- | ------------------ | --------- | -------------------------------------------- |
| GET    | `/api/roles`           | `roles:list:all`   |           | Lists roles, paged, with an optional search  |
| GET    | `/api/roles/:idOrSlug` | `roles:read:all`   |           | Returns one role                             |
| POST   | `/api/roles`           | `roles:create:all` |           | Creates a custom role                        |
| PATCH  | `/api/roles/:idOrSlug` | `roles:update:all` |           | Changes the name, description or permissions |
| DELETE | `/api/roles/:idOrSlug` | `roles:delete:all` |           | Deletes a role that no account holds         |

A role name takes Latin letters, digits, spaces and hyphens, and is 2 to 50 characters long. System roles cannot be deleted.

## User administration (`/api/admin/users`)

| Method | Path                                           | Who may call it          | Closed by | What it does                                             |
| ------ | ---------------------------------------------- | ------------------------ | --------- | -------------------------------------------------------- |
| GET    | `/api/admin/users`                             | `users:list:all`         |           | Lists accounts, paged, with filters                      |
| POST   | `/api/admin/users`                             | `users:create:all`       |           | Creates an account                                       |
| GET    | `/api/admin/users/:id`                         | `users:read:all`         |           | Returns one account                                      |
| PATCH  | `/api/admin/users/:id`                         | `users:update:all`       |           | Changes the name or the email                            |
| POST   | `/api/admin/users/:id/resend-email-change`     | `users:update:all`       |           | Mails the confirmation code for a changed email again    |
| PATCH  | `/api/admin/users/:id/status`                  | `users:update:all`       |           | Activates or deactivates the account                     |
| PATCH  | `/api/admin/users/:id/role`                    | `users:update:all`       |           | Assigns a role                                           |
| DELETE | `/api/admin/users/:id`                         | `users:delete:all`       |           | Deactivates the account and ends its sessions. See below |
| GET    | `/api/admin/users/:id/permissions`             | `permissions:read:all`   |           | Lists the permissions of the account                     |
| POST   | `/api/admin/users/:id/permissions`             | `permissions:grant:all`  |           | Adds a direct permission                                 |
| DELETE | `/api/admin/users/:id/permissions/:permission` | `permissions:revoke:all` |           | Removes a direct permission                              |

`DELETE /api/admin/users/:id` deactivates the account. It does not remove the record, and `PATCH /api/admin/users/:id/status` can activate the account again. The routes that change an account refuse one at or above the caller's own role level.

The permission in the table opens the route. Three routes also hold the caller to what the caller holds itself, the same rule a role edit follows:

- `POST /api/admin/users/:id/permissions` adds only a permission the caller holds. A caller with `*` holds every permission. `*` itself is never added here.
- `PATCH /api/admin/users/:id/role` and `POST /api/admin/users` assign only a role whose permissions the caller holds, all of them. The role must also sit below the caller's level, and `admin` is never assigned.

A request over that limit is answered 403 with the code `FORBIDDEN`, and nothing is stored. Removing a direct permission has no such limit, as removing a permission from a role has none: the caller needs `permissions:revoke:all` and a level above the account's.

## Mobile app sign-in (`/api/oauth`)

| Method | Path                                   | Who may call it | Closed by | What it does                                                  |
| ------ | -------------------------------------- | --------------- | --------- | ------------------------------------------------------------- |
| GET    | `/api/oauth/authorize`                 | Public          |           | Starts a sign-in for a mobile app and redirects to the client |
| GET    | `/api/oauth/authorize/transaction/:id` | Signed in       |           | Returns the pending request the consent page shows            |
| POST   | `/api/oauth/authorize/approve`         | Signed in       |           | Approves the pending request                                  |
| POST   | `/api/oauth/authorize/deny`            | Signed in       |           | Denies the pending request                                    |
| POST   | `/api/oauth/token`                     | Public          |           | Exchanges a code or a refresh token for a new token pair      |
| POST   | `/api/oauth/revoke`                    | Public          |           | Revokes a refresh token and its session                       |

These routes stay in place with `AUTH_NATIVE_ENABLED=false` and refuse every request. Their error shapes are in the [backend guide](../README.md#native-oauth-error-shapes).
