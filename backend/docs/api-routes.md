# API routes

Every route the backend serves. All of them sit under `/api`, except `/health`.

Native account attempts, factors and bearer proof routes are in [native account routes](native-account-routes.md).

How to read the tables:

- **Public** needs no sign-in.
- **Signed in** needs the session cookie, or the access token of a mobile app.
- A permission such as `users:read:all` means signed in and holding that permission, through the role or directly. `*` holds every permission.
- Permissions joined by **or** mean that holding any one of them is enough.
- **Staff** needs a staff account in a browser session of the admin console, signed in with a passkey when that application asks for one. The check applies while a configured application serves the staff audience.
- **Closed by** names the setting that turns the route off. With that setting `false` the route answers `404` with the error code `FEATURE_DISABLED`.

## Server

| Method | Path      | Who may call it | Closed by | What it does                                 |
| ------ | --------- | --------------- | --------- | -------------------------------------------- |
| GET    | `/health` | Public          |           | Reports whether the server and database work |
| GET    | `/api`    | Public          |           | Answers with a short text, as a liveness URL |

## Sign-in and account (`/api/auth`)

| Method | Path                              | Who may call it | Closed by               | What it does                                                                                                   |
| ------ | --------------------------------- | --------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/auth/methods`               | Public          |                         | Lists the sign-in methods this server has turned on                                                            |
| GET    | `/api/auth/identity`              | Public          |                         | Optional current identity. Signed-out browsers receive 200; invalid native credentials are refused.            |
| GET    | `/api/auth/browser-proof`         | Public          |                         | Issues the short-lived proof a browser sends before it has a session                                           |
| GET    | `/api/auth/csrf`                  | Signed in       |                         | Returns the CSRF secret of the current session                                                                 |
| POST   | `/api/auth/register`              | Public          | `AUTH_PASSWORD_ENABLED` | Starts a sign-up and mails a 6-digit code                                                                      |
| POST   | `/api/auth/activate`              | Public          | `AUTH_PASSWORD_ENABLED` | Finishes the sign-up with the code, a name and a password                                                      |
| POST   | `/api/auth/resend-activation`     | Public          | `AUTH_PASSWORD_ENABLED` | Mails a new sign-up code                                                                                       |
| POST   | `/api/auth/login`                 | Public          | `AUTH_PASSWORD_ENABLED` | Signs in with email and password                                                                               |
| POST   | `/api/auth/forgot-password`       | Public          | `AUTH_PASSWORD_ENABLED` | Mails a 6-digit password reset code                                                                            |
| POST   | `/api/auth/reset-password`        | Public          | `AUTH_PASSWORD_ENABLED` | Sets a new password with the reset code                                                                        |
| POST   | `/api/auth/confirm-email-change`  | Public          |                         | Moves the account to the address an administrator asked for                                                    |
| POST   | `/api/auth/logout`                | Signed in       |                         | Ends the current session and clears its cookie                                                                 |
| GET    | `/api/auth/account-deletion/:key` | Public          |                         | Answers `recorded`, `not_recorded` or `unknown` for the receipt key a deletion was sent with. Names no account |

With `AUTH_PASSWORD_ENABLED=false`, `activate` and `resend-activation` answer `404` along with the other password routes, and so does `POST /api/user/password` further down.

<!-- feature:email-code:start -->

## Browser email code (`/api/auth/email-code`)

| Method | Path                           | Access | Requires             | Notes                                                                                                               |
| ------ | ------------------------------ | ------ | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/auth/email-code/request` | Public | `EMAIL_CODE_ENABLED` | Accepts email and optional locale, binds the browser ceremony cookie, and returns a generic canonical address reply |
| POST   | `/api/auth/email-code/verify`  | Public | `EMAIL_CODE_ENABLED` | Accepts only code, spends the matching browser ceremony, then issues a session or a second-factor challenge         |

<!-- feature:email-code:end -->

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

| Method | Path                                  | Who may call it | Closed by          | What it does                                                                               |
| ------ | ------------------------------------- | --------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| POST   | `/api/auth/passkeys/login/options`    | Public          | `PASSKEYS_ENABLED` | Returns the options for a passkey sign-in                                                  |
| POST   | `/api/auth/passkeys/login/verify`     | Public          | `PASSKEYS_ENABLED` | Signs in with a passkey                                                                    |
| POST   | `/api/auth/passkeys/register/options` | Signed in       | `PASSKEYS_ENABLED` | Returns the options for adding a passkey. A mobile app's access token gets `403 FORBIDDEN` |
| POST   | `/api/auth/passkeys/register/verify`  | Signed in       | `PASSKEYS_ENABLED` | Stores the new passkey. A mobile app's access token gets `403 FORBIDDEN`                   |
| GET    | `/api/auth/passkeys`                  | Signed in       | `PASSKEYS_ENABLED` | Lists the passkeys on the account, newest first                                            |
| PATCH  | `/api/auth/passkeys/:id`              | Signed in       | `PASSKEYS_ENABLED` | Renames a passkey                                                                          |
| DELETE | `/api/auth/passkeys/:id`              | Signed in       | `PASSKEYS_ENABLED` | Removes a passkey                                                                          |

<!-- feature:passkeys:end -->

## Fresh proof (`/api/auth/proof`)

| Method | Path                          | Who may call it | Closed by | What it does                                                |
| ------ | ----------------------------- | --------------- | --------- | ----------------------------------------------------------- |
| POST   | `/api/auth/proof/code`        | Signed in       |           | Mails a proof code to the signed-in account's own address   |
| POST   | `/api/auth/proof/code/verify` | Signed in       |           | Records a proof on the current session from the mailed code |

<!-- feature:passkeys:start -->

| Method | Path                      | Who may call it | Closed by          | What it does                                                   |
| ------ | ------------------------- | --------------- | ------------------ | -------------------------------------------------------------- |
| POST   | `/api/auth/proof/options` | Signed in       | `PASSKEYS_ENABLED` | Returns the options for a passkey check of the current session |
| POST   | `/api/auth/proof/verify`  | Signed in       | `PASSKEYS_ENABLED` | Records a proof on the current session from a verified passkey |

<!-- feature:passkeys:end -->

The browser proof routes take a full browser session. The native proof routes take a validated bearer access session. A proof belongs to the session that made it, counts for five minutes, and never signs anyone in or changes the session id. Where the application requires a passkey only the passkey check counts, made with user verification, and the code route answers `403 FEATURE_DISABLED`. A wrong or expired code answers `401 ACTIVATION_CODE_INVALID`, and five wrong codes end that code.

A staff route that needs a proof answers `401 REAUTH_REQUIRED` with `details.required` set to `fresh_proof` and `details.methods` naming what would satisfy it.

<!-- feature:invitations:start -->

## Invitations (`/api/auth/invitations`)

| Method | Path                           | Who may call it | Closed by | What it does                                                             |
| ------ | ------------------------------ | --------------- | --------- | ------------------------------------------------------------------------ |
| POST   | `/api/auth/invitations/accept` | Public          |           | Spends an invitation or enrolment link, creates the account, signs it in |

The token travels in the mailed link's fragment, and the page posts it only when the person presses Accept. An unknown, used, revoked or expired token answers `400 INVITATION_INVALID`, and so does an invitation whose role, audience or inviter's authority changed since it was sent. Where the invitation's application requires a passkey, the session is a 15-minute enrolment session.

<!-- feature:invitations:end -->
<!-- feature:oauth-core:start -->

## Sign-in with a provider (`/api/auth/oauth`)

| Method | Path                                 | Who may call it | Closed by | What it does                                                        |
| ------ | ------------------------------------ | --------------- | --------- | ------------------------------------------------------------------- |
| GET    | `/api/auth/oauth/providers`          | Public          |           | Lists the providers that have credentials configured                |
| GET    | `/api/auth/oauth/:provider/start`    | Public          |           | Legacy web navigation start                                         |
| POST   | `/api/auth/oauth/:provider/start`    | Public          |           | Starts the Origin-selected application and returns the provider URL |
| GET    | `/api/auth/oauth/:provider/callback` | Public          |           | Receives the provider's answer, signs in, redirects to the client   |
| POST   | `/api/auth/oauth/:provider/callback` | Public          |           | The same callback for providers that post a form, such as Apple     |
| POST   | `/api/auth/oauth/callback`           | Public          |           | Removed. Always answers `410`                                       |

<!-- feature:oauth-core:end -->

## Own profile and sessions (`/api/user`)

| Method | Path                               | Who may call it | Closed by               | What it does                                                             |
| ------ | ---------------------------------- | --------------- | ----------------------- | ------------------------------------------------------------------------ |
| GET    | `/api/user/profile`                | Signed in       |                         | Returns the signed-in account                                            |
| PATCH  | `/api/user/profile`                | Signed in       |                         | Updates the name or the mail language                                    |
| POST   | `/api/user/password`               | Signed in       | `AUTH_PASSWORD_ENABLED` | Changes the password, given the current one                              |
| DELETE | `/api/user/account`                | Signed in       |                         | Deactivates the own account, ends sessions and schedules enabled erasure |
| GET    | `/api/user/sessions`               | Signed in       |                         | Lists the active sessions of the account                                 |
| DELETE | `/api/user/sessions/:sessionId`    | Signed in       |                         | Ends one other session. It refuses the current one                       |
| POST   | `/api/user/sessions/revoke-others` | Signed in       |                         | Ends every session except the current one                                |
| GET    | `/api/user/email`                  | Signed in       |                         | Returns the address and the pending one                                  |
| POST   | `/api/user/email`                  | Signed in       |                         | Asks to move the account to another address                              |
| POST   | `/api/user/email/confirm`          | Signed in       |                         | Moves the account with the mailed code                                   |
| DELETE | `/api/user/email`                  | Signed in       |                         | Cancels the pending change                                               |

`POST /api/user/email` needs a sign-in in the last five minutes, a fresh proof bound to the same session and application, or the account's password sent as `password`. It answers `401` with `REAUTH_REQUIRED` otherwise, and `400` with `INVALID_CURRENT_PASSWORD` for a wrong password. Mobile sessions carry actual authentication time, including the approving browser's older sign-in time. The new address is held in the address ledger until the change is confirmed, cancelled or its code lapses. An address that an account, another pending change or an invitation holds gets the same answer, the same pending state and the same database work as a free one. It never receives a code, so the code step is where the change fails. The current address gets a notice either way. A second request replaces the first and kills its code.

`POST /api/user/email/confirm` confirms only a change the person asked for. It keeps the session that sends it and ends every other session with the reason `email_changed`. The address the account left gets a notice. `DELETE /api/user/email` needs the proof a request needs, with `password` in an optional JSON body, whoever started the change.

`POST /api/auth/confirm-email-change` and the app route below confirm only a change staff started. They answer the shared invalid-code error for a code the person asked for, and end every session with the reason `email_changed`.

<!-- feature:oauth-core:start -->

## Linked providers (`/api/user`)

| Method | Path                                  | Who may call it | Closed by | What it does                                                                                |
| ------ | ------------------------------------- | --------------- | --------- | ------------------------------------------------------------------------------------------- |
| GET    | `/api/user/linked-providers`          | Signed in       |           | Lists the sign-in methods on the account                                                    |
| DELETE | `/api/user/unlink-provider/:provider` | Signed in       |           | Unlinks a provider from the account                                                         |
| POST   | `/api/user/set-primary-provider`      | Signed in       |           | Chooses the provider the profile is synced from                                             |
| GET    | `/api/user/sync-status`               | Signed in       |           | Returns the last profile sync and the primary provider                                      |
| POST   | `/api/user/sync-profile`              | Signed in       |           | Syncs the profile from the primary provider now                                             |
| POST   | `/api/user/link-provider`             | Signed in       |           | Removed. Always answers `410`                                                               |
| POST   | `/api/user/providers/link/start`      | Signed in       |           | Starts a link from a mobile app: a nonce bound to the account, the session and the provider |
| POST   | `/api/user/providers/link/finish`     | Signed in       |           | Links the provider identity the proof made with that nonce names                            |

To link a provider, fetch `POST /api/auth/oauth/:provider/start` with browser
credentials and proof, then navigate to the returned provider URL. The retained
GET navigation start always selects web.

A mobile app links through `providers/link/start` and `providers/link/finish`
instead. The start needs a fresh proof or an actual sign-in within the last
five minutes. Browser-approved mobile sessions retain the browser's earlier
sign-in time. The finish accepts proof for the ticket's `nonceDigest`, once,
within ten minutes, from the same session. Apple prompt adapters check the
returned `state` locally. The server binds the finish through its ticket and
nonce, and does not claim to verify that prompt state. Because the person
proved both the account and the identity, the provider's address may differ
from the account's; the browser flow keeps requiring the same address.

<!-- feature:oauth-core:end -->

## Roles (`/api/roles`)

| Method | Path                   | Who may call it           | Closed by | What it does                                 |
| ------ | ---------------------- | ------------------------- | --------- | -------------------------------------------- |
| GET    | `/api/roles`           | Staff, `roles:list:all`   |           | Lists roles, paged, with an optional search  |
| GET    | `/api/roles/:idOrSlug` | Staff, `roles:read:all`   |           | Returns one role                             |
| POST   | `/api/roles`           | Staff, `roles:create:all` |           | Creates a custom role                        |
| PATCH  | `/api/roles/:idOrSlug` | Staff, `roles:update:all` |           | Changes the name, description or permissions |
| DELETE | `/api/roles/:idOrSlug` | Staff, `roles:delete:all` |           | Deletes a role that no account holds         |

A role name takes Latin letters, digits, spaces and hyphens, and is 2 to 50 characters long. System roles cannot be deleted.

## User administration (`/api/admin/users`)

| Method | Path                                           | Who may call it                                             | Closed by | What it does                                                          |
| ------ | ---------------------------------------------- | ----------------------------------------------------------- | --------- | --------------------------------------------------------------------- |
| GET    | `/api/admin/users`                             | Staff, `users:list:all` or `users:list:staff`               |           | Lists accounts, paged, with filters                                   |
| POST   | `/api/admin/users`                             | Staff, `users:create:all` or `users:create:staff`           |           | Creates an account                                                    |
| GET    | `/api/admin/users/:id`                         | Staff, `users:read:all` or `users:read:staff`               |           | Returns one account                                                   |
| PATCH  | `/api/admin/users/:id`                         | Staff, `users:update:all` or `users:update:staff`           |           | Changes the name, or asks for an email                                |
| POST   | `/api/admin/users/:id/resend-email-change`     | Staff, `users:update:all` or `users:update:staff`           |           | Mails the code for the email that waits again                         |
| DELETE | `/api/admin/users/:id/email-change`            | Staff, `users:update:all` or `users:update:staff`           |           | Current administrator cancels a pending address; peer requires an act |
| PATCH  | `/api/admin/users/:id/status`                  | Staff, `users:suspend:all` or `users:suspend:staff`         |           | Suspends or restores the account                                      |
| PATCH  | `/api/admin/users/:id/role`                    | Staff, `users:assign-role:all` or `users:assign-role:staff` |           | Assigns a role                                                        |
| DELETE | `/api/admin/users/:id`                         | Staff, `users:delete:all` or `users:delete:staff`           |           | Deactivates the account and ends its sessions. See below              |
| GET    | `/api/admin/users/:id/permissions`             | Staff, `permissions:read:all`                               |           | Lists the permissions of the account                                  |
| POST   | `/api/admin/users/:id/permissions`             | Staff, `permissions:grant:all`                              |           | Adds a direct permission                                              |
| DELETE | `/api/admin/users/:id/permissions/:permission` | Staff, `permissions:revoke:all`                             |           | Removes a direct permission                                           |

| Method | Path                                       | Who may call it              | Closed by | What it does                                                           |
| ------ | ------------------------------------------ | ---------------------------- | --------- | ---------------------------------------------------------------------- |
| GET    | `/api/admin/users/:id/sessions`            | Staff, `sessions:read:all`   |           | Lists the target account's active sessions                             |
| DELETE | `/api/admin/users/:id/sessions/:sessionId` | Staff, `sessions:delete:all` |           | Ends one target session                                                |
| POST   | `/api/admin/users/:id/sessions/revoke-all` | Staff, `sessions:delete:all` |           | Ends every target session                                              |
| GET    | `/api/admin/activity`                      | Staff, `activity:read:all`   |           | Lists retained staff activity, paged, with filters                     |
| GET    | `/api/admin/erasure-jobs`                  | Staff, `users:delete:all`    |           | Lists erasures that have not finished and flagged provider revocations |

<!-- feature:oauth-core:start -->

| Method | Path                                            | Who may call it           | Closed by | What it does                                                    |
| ------ | ----------------------------------------------- | ------------------------- | --------- | --------------------------------------------------------------- |
| POST   | `/api/admin/erasure-jobs/revocations/:id/close` | Staff, `users:delete:all` |           | Ends a pending provider revocation without calling the provider |

<!-- feature:oauth-core:end -->

<!-- feature:invitations:start -->

| Method | Path                                | Who may call it                                   | Closed by | What it does                                           |
| ------ | ----------------------------------- | ------------------------------------------------- | --------- | ------------------------------------------------------ |
| GET    | `/api/admin/invitations`            | Staff, `users:list:all` or `users:list:staff`     |           | Lists invitations, paged, by status                    |
| POST   | `/api/admin/invitations`            | Staff, `users:create:all` or `users:create:staff` |           | Invites an address to a role and mails the link        |
| POST   | `/api/admin/invitations/:id/resend` | Staff, `users:create:all` or `users:create:staff` |           | Replaces the invitation's token and mails the new link |
| DELETE | `/api/admin/invitations/:id`        | Staff, `users:create:all` or `users:create:staff` |           | Revokes an invitation and frees its address            |

<!-- feature:passkeys:start -->

| Method | Path                                 | Who may call it                                   | Closed by          | What it does                                                     |
| ------ | ------------------------------------ | ------------------------------------------------- | ------------------ | ---------------------------------------------------------------- |
| POST   | `/api/admin/users/:id/passkey-reset` | Staff, `users:update:all` or `users:update:staff` | `PASSKEYS_ENABLED` | Removes the passkeys, ends the sessions, mails an enrolment link |

<!-- feature:passkeys:end -->

A staff role also needs the `:staff` permission of the same action. Inviting an administrator, and resetting another administrator's passkeys, need an administrator with a fresh proof. See `docs/setup/setup-invitations.md`.

<!-- feature:invitations:end -->

`DELETE /api/admin/users/:id` deactivates the account. It does not remove the record, and `PATCH /api/admin/users/:id/status` can activate the account again. The routes that change an account refuse one at or above the caller's own role level.

`PATCH /api/admin/users/:id` with an email does not change the address. Only an `admin` may send one. The account keeps its address, and everything that address can do, until `POST /api/auth/confirm-email-change` is called with the code mailed to the new address. That call moves the address and ends the account's sessions. An account carries `pendingEmail` in the list, in `GET /api/admin/users/:id` and in the answer to the `PATCH` while an address waits.

Role reassignment requires `users:assign-role:all` for customers or
`users:assign-role:staff` for staff when audiences are enabled. With audiences
disabled, `users:assign-role:all` applies to every account. Ordinary profile
update does not grant role reassignment.

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
