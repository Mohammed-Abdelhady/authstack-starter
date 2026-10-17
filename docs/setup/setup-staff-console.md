# Staff Console Setup Guide

Staff work in the admin application. This guide covers the rules every staff change follows and the
setting that makes them strict.

## Settings

| Setting                   | What it does                                                                                       | Default |
| ------------------------- | -------------------------------------------------------------------------------------------------- | ------- |
| `ACTIVITY_RETENTION_DAYS` | Days a staff action stays in the activity log. Sign-in events keep 90 days                         | `730`   |
| `ADMIN_STRICT_MUTATIONS`  | Off, staff routes accept today's requests. On, they need a fresh proof, a version and a create key | `false` |

## What every staff change does

- It records one event in the activity log, in the same transaction as the change. A change that rolls
  back leaves no event.
- It checks the version it was read at, when the request sends one. Accounts and roles carry a
  `version` that every write to a field staff read raises, whoever makes it: staff, the person, or a
  worker. Session bookkeeping does not raise it. A stale version answers `409 CONFLICT` and nothing
  changes. `PATCH` and `POST` bodies take `version`; a `DELETE` takes `?version=`.
- A create accepts an `Idempotency-Key` header, 8 to 128 letters, digits, hyphens or underscores. The
  key belongs to one staff member, one application and one kind of create, and is kept for 24 hours.
  Sending the same request again with the key returns the first result and writes nothing. The same key
  with another body answers `409 CONFLICT`.

With `ADMIN_STRICT_MUTATIONS=true` these become required:

- a fresh proof on role create, update and delete, permission grant and revoke, role assignment,
  account deletion and an address change;
- a `version` on every change to an account or a role;
- an `Idempotency-Key` on every create.

## Fresh proof

A proof is an act or an age. An act is a passkey check with user verification, through
`POST /api/auth/proof/options` and `/verify`, or a code mailed to the staff member's own address,
through `POST /api/auth/proof/code` and `/code/verify`. An age is a sign-in in the last five minutes.

Where the admin application requires a passkey, only the passkey check counts. Inviting an
administrator, resetting another administrator's passkeys, ending another administrator's sessions
and changing another administrator's address always need an act from the last five minutes, whatever
the setting. A refusal answers `401 REAUTH_REQUIRED` with `details.required` set to `fresh_proof`.

## Suspending

Suspending and restoring an account need `users:suspend:all`, or `users:suspend:staff` for a staff
account. Renaming still needs only the update permission. Upgrading gives the suspend permission to
every role and direct grant that held the matching update permission, on both databases, so nobody
loses the power to suspend.

## The admin role and the last administrator

Nobody edits, renames or deletes the `admin` role. One administrator who can sign in must always
remain: active, and either holding a passkey for the admin application's relying party where it
requires one, or a verified address with no change pending. A change that would leave none answers
`409 CONFLICT`.
