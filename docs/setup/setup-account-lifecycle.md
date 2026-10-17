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
needs a fresh proof. A browser or mobile session authenticated within the last
five minutes qualifies. For a mobile session approved by a browser, freshness
comes from the browser's actual sign-in time, not when approval or token exchange
happened. An older session needs a fresh proof bound to the same session and
application. The finish takes the proof the app's provider prompt
made with the start's nonce, once, from the same session, within ten minutes. An identity that
belongs to another account is refused and the accounts are never merged. The provider's address
may differ from the account's, so an account made with Apple's private relay address can add
Google.

What stays after an account is erased, and for how long, is listed in
[`docs/reference/account-erasure.md`](../reference/account-erasure.md).

## Changing your own email address

Live from plan 5 part a. No setting turns it on or off.

1. The signed-in person sends the new address to `POST /api/user/email`. The route needs a
   sign-in in the last five minutes, a fresh proof bound to that session and
   application, or the account's password. A browser-approved mobile session
   retains the browser's actual sign-in time, so approval cannot renew this window.
   A required-passkey application needs a user-verified proof for its current relying party.
   The mobile engine requests `/api/auth/native/proof/options`, uses the system passkey prompt,
   and verifies at `/api/auth/native/proof/verify`. The email form retries the same action once,
   only after proof succeeds on the same session. Canceling retains the form. Password fallback
   cannot replace the required passkey proof.
2. A six-digit code goes to the new address and a notice to the current one. An address that
   another account, a pending change or an invitation holds gets the same answer and never a
   code, so the answer does not tell which addresses are taken.
3. `POST /api/user/email/confirm` with the code moves the account. The device that confirms
   stays signed in, every other session ends, and the old address is told. Only a session of
   the account that asked confirms it. The public and app confirmation routes refuse the code.
4. `DELETE /api/user/email` cancels a pending change and frees the address. It needs the same
   proof as step 1.

A change that staff started is confirmed by someone who may be signed out, on the web page the
mail links to, or from a mobile app through `POST /api/auth/native/email-change/confirm` with
the app's registered `clientId`, the new address and the code. The starter sign-in screen has a
confirmation entry using a credential-free transport. The owner can point `emailChangeCode` in
`MAIL_LINKS_CUSTOMER` at the app's configured link host after verifying its platform routing.
Until then, the web confirmation page remains a working mail destination.

## Account notices

Live from plan 5 part c. Notices go out after the change commits, to the address the change was
read with, so a notice still reaches the address an account just left. Each notice exists in
English and Arabic, names the time in UTC and, except for staff actions, the device that made the
change. No notice carries a code or a sign-in link.

| Notice                 | Sent when                                                            |
| ---------------------- | -------------------------------------------------------------------- |
| Email change requested | Someone signed in asks to move the account, to the current address   |
| Email changed          | The move is confirmed, to the address the account left               |
| Passkey removed        | A passkey is removed from the account                                |
| New device             | A later sign-in uses an unseen installation or browser/platform pair |
| Account deactivated    | Staff suspend or delete the account                                  |
| Account restored       | Staff restore the account                                            |
| Passkeys reset         | Staff reset the account passkeys                                     |

New-device detection commits with successful session issuance. The first sign-in
of a new account remembers its device without sending a notice. Each account
keeps at most its newest 20 device hashes and one UTC day's notice count, with at
most three new-device notices per UTC day. Concurrent sign-ins share the same
account lock. Rolled-back sign-ins remember nothing and send no mail. Mobile
exchange sends the engine's persisted installation digest. A legacy client that
omits it gets no installation notice. Raw installation identifiers are neither
stored nor logged. The committed recipient and event facts are captured before
mail is dispatched outside the transaction. SMTP failure never undoes sign-in.

A self-started pending email claim does not reserve another person's mailbox
against proven registration. Registration can mail its proof and atomically
replace that claim after proof succeeds. Staff recovery, invitations and account
addresses retain their reservations. The old change code then fails its ledger
ownership check. Lapsed claims can be taken immediately without waiting for TTL
cleanup. Request replies remain uniform.
