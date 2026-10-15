# Account Lifecycle Setup Guide

Used from plan 5. Today account deletion remains reversible soft deletion. No erasure worker or provider-token retention is enabled.

## Reserved settings

| Setting                                  | Reservation                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ACCOUNT_ERASE_GRACE_DAYS`               | Used from plan 5. Unset disables erasure, zero means immediate erasure once implemented. |
| `PROVIDER_TOKEN_ENCRYPTION_KEY`          | Used from plan 5. Optional secret provider-token encryption key.                         |
| `PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS` | Used from plan 5. Optional previous secret key during rotation.                          |

Keep optional, secret and erasure settings unset until plan 5 is implemented.
Provider-token keys require at least 32 characters and are parsed independently.
Plan 5 must require a current key when a previous key is set, and require the keys
to differ.
A grace period of `0` must remain distinct from absence. Plan 5 must replace the
disabled erasure-lock binding before starting an erasure worker.

## Changing your own email address

Live from plan 5 part a. No setting turns it on or off.

1. The signed-in person sends the new address to `POST /api/user/email`. The route needs a
   browser sign-in in the last five minutes, or the account's password. A mobile app session
   always sends the password, because a session the app gets by approving a browser sign-in
   starts at the approval and its age proves nothing. Until the app's session carries the time
   of the sign-in behind it, an account without a password changes its address from a browser.
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
the app's registered `clientId`, the new address and the code. The starter's mobile UI has no
screen for that route yet. Keep `emailChangeCode` in `MAIL_LINKS_CUSTOMER` on the web
confirmation page until the host app adds a signed-out screen that opens from the mail's link
and calls `account.email.confirmFromApp`, then point the template at the app's link host.

## Account notices

Live from plan 5 part c. Notices go out after the change commits, to the address the change was
read with, so a notice still reaches the address an account just left. Each notice exists in
English and Arabic, names the time in UTC and, except for staff actions, the device that made the
change. No notice carries a code or a sign-in link.

| Notice                 | Sent when                                                          |
| ---------------------- | ------------------------------------------------------------------ |
| Email change requested | Someone signed in asks to move the account, to the current address |
| Email changed          | The move is confirmed, to the address the account left             |
| Passkey removed        | A passkey is removed from the account                              |
| New device             | Reserved. Sent once sign-in records the devices an account uses    |
| Account deactivated    | Reserved for the staff status route                                |
| Account restored       | Reserved for the staff status route                                |
| Passkeys reset         | Reserved for the staff passkey reset                               |
