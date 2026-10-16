# Account Lifecycle Setup Guide

Deleting an account is a reversible deactivation until `ACCOUNT_ERASE_GRACE_DAYS` is set. With it
set, a person's own deletion is erased for good once the grace period ends, and Apple's grant is
revoked.

## Settings

| Setting                                  | What it does                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACCOUNT_ERASE_GRACE_DAYS`               | Unset: deletion only deactivates, as before, and nothing is erased. A whole number of days: a deleted account is erased that long after its deletion. `0` erases at once. |
| `PROVIDER_TOKEN_ENCRYPTION_KEY`          | Secret of at least 32 characters. Encrypts the refresh tokens Apple hands out, so they can be revoked. Unset: no token is kept.                                           |
| `PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS` | The key before the current one, during a rotation. Needs `PROVIDER_TOKEN_ENCRYPTION_KEY`, and must differ from it.                                                        |

The server refuses to start with a negative or fractional grace, a key under 32 characters, a
previous key without a current one, or a previous key equal to the current one.

## Erasing deleted accounts

1. A person deletes their own account with `DELETE /api/user/account`. Their sessions end at
   once and the account cannot sign in. With erasure on, the account is given an erasure date
   and a mail in its language names that date. Staff deletion, `DELETE /api/admin/users/:id`,
   only deactivates.
2. Until the erasure starts, staff can restore the account through
   `PATCH /api/admin/users/:id/status`. The restore and the erasure take the same lock on the
   account, so one of them wins: a restored account is no longer scheduled, and an account
   whose erasure started is never restored.
3. A worker looks for due accounts every minute, ten at a time, and erases each in three steps
   that its job row records:
   - it marks the account as being erased; from here nothing can restore it;
   - it calls the host product's hook, `HOST_ERASURE_HOOK` in `backend/src/host/account-erasure.ts`;
   - in one transaction it removes every row that points at the account, its sessions or its
     addresses, blanks the personal fields of the log rows where the account is actor or
     target, writes the provider revocation jobs, and removes the account. The address is free
     to register again, under a new id. A pending email change counts as the account's address
     only while its claim on the new address holds; once that lapses, the address may be
     another account's, and nothing is removed by it.
4. A hook that fails leaves the account whole and unable to sign in. The job keeps a reason
   code, never the error's text, and tries again after 1 minute, then 2, 4 and so on up to a
   day. `GET /api/admin/erasure-jobs` lists every erasure that has not finished.

A worker that dies part way resumes at the step its job reached: a job past the hook never calls
it again. Two servers never erase one account twice.

The hook must be safe to call twice for one account. A hook whose data lives in the same
database sets `runsInEraseTransaction` and runs inside the final transaction instead, so a
failure there rolls the whole removal back.

### Accounts deleted while erasure was off

A person's own deletion marks the account with its time, even while erasure is off. Staff never
mark one, and a later staff deactivation or restore moves the account away from its mark. These
accounts keep no erasure date and stay deactivated. To erase them, run the schedule command once
erasure is on. It gives every account its owner deleted, still deactivated and without a date,
the grace period from now, or the time you pass with `--at`. An account staff deactivated is
left alone:

```bash
pnpm --filter backend exec ts-node -r tsconfig-paths/register src/user/erasure/cli/erasure-schedule.ts
pnpm --filter backend exec ts-node -r tsconfig-paths/register src/user/erasure/cli/erasure-schedule.ts --at 2027-01-01T00:00:00Z
```

An account deleted before this version first ran carries no mark, and nothing tells its owner's
deletion apart from a staff deactivation. To include those, pass `--deleted-before` with the time
this version was first deployed. Every unmarked deactivated account deleted before that time is
then dated too, the ones staff deactivated included. Review them first and restore the accounts
staff only suspended:

```bash
pnpm --filter backend exec ts-node -r tsconfig-paths/register src/user/erasure/cli/erasure-schedule.ts --deleted-before 2026-11-01T00:00:00Z
```

From a build, run `node dist/user/erasure/cli/erasure-schedule.js` in `backend/`.

## Deletion receipts

A phone can lose the answer to its delete request after the request ended its session. The
request may carry a receipt key the app made and stored before sending,
`r1.<epoch ms>.<64 lowercase hex>`; the SDK builds one with `deletionReceiptKey`. The server
keeps a hash of the key with the deletion for 90 days, whatever becomes of the account.

`GET /api/auth/account-deletion/:key` is public and answers `recorded`, `not_recorded` or
`unknown`, and never names an account. `not_recorded` does not prove the deletion failed while
the first request may still be on its way: ask again after a wait before concluding anything.
After 90 days the answer is `unknown`. The same key sent twice deletes once and gets the same
answer.

## Apple tokens and revocation

Every Apple sign-in and link, in a browser or in an app, keeps the refresh token Apple returns,
encrypted, beside the client id that obtained it. Erasing an account or unlinking Apple moves
the token into a revocation job in the same transaction. A separate runner, outside any account
transaction, calls Apple every five minutes:

- Apple confirms, or answers that the token already grants nothing: the token is removed;
- Apple fails: the job waits longer each time, keeps its token, and after five failures is
  flagged and listed by `GET /api/admin/erasure-jobs`;
- staff who revoked the grant another way close the job with
  `POST /api/admin/erasure-jobs/revocations/:id/close`.

Every job and its token are deleted 30 days after the job was written, revoked or not. An
account from before tokens were kept, or from a server without a key, gets a job closed at once
with the reason `no_token`.

A token is also kept when the sign-in goes no further, such as a sign-up that is refused after
Apple answered, or a sign-in that races the account's erasure. A day after a token is kept, the
runner checks that some account links its Apple identity. A token no account claims moves into
a job with the reason `unclaimed` and no account, and is revoked like the others. A token the
database refuses to store is revoked at once, since nothing could revoke it later; the person's
next Apple sign-in asks for consent again.

To rotate the key, move the current key to `PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS`, put a new
key in `PROVIDER_TOKEN_ENCRYPTION_KEY` and restart. A token kept under the old key is still read
and revoked. A kept token is written again under the new key only when its account next signs
in with Apple, so a token never rewritten can be revoked only while the previous key is set.
Removing it leaves such a token unreadable, and its later revocation job fails as
`token_unreadable` and is flagged for staff.

## Linking a provider from an app

A mobile app links Google, Apple or Facebook (limited login) through
`POST /api/user/providers/link/start` and `POST /api/user/providers/link/finish`. The start
needs a fresh proof. A browser session signed in within the last five minutes is one. A mobile
session's age is not yet, because a session made when a signed-in browser approves the app
carries the approval time, so the start answers `REAUTH_REQUIRED` to an app until that session
carries the browser's sign-in time. The finish takes the proof the app's provider prompt
made with the start's nonce, once, from the same session, within ten minutes. An identity that
belongs to another account is refused and the accounts are never merged. The provider's address
may differ from the account's, so an account made with Apple's private relay address can add
Google.

What stays after an account is erased, and for how long, is listed in
[`docs/reference/account-erasure.md`](../reference/account-erasure.md).
