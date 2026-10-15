# Email Code Setup Guide

A native app can sign a person in with a six-digit code mailed to their
address. The person types the code into the app on any device. When the
application also has the email link, the same mail carries a button that
finishes the same sign-in on the phone that asked. An unknown address becomes an
account when the application lets people sign up.

This guide covers the server, and the app screens under
[In the app](#in-the-app). The review settings below give app store reviewers
a way in, as
[Access for app store reviewers](#access-for-app-store-reviewers) explains.

## Settings

| Setting                        | Meaning                                                                    |
| ------------------------------ | -------------------------------------------------------------------------- |
| `EMAIL_CODE_ENABLED`           | Turns email-code sign-in on for the server. Default `false`.               |
| `EMAIL_CODE_EXPIRES_IN`        | Code lifetime in milliseconds. Default `600000`, ten minutes.              |
| `EMAIL_CODE_REVIEW_ACCOUNT_ID` | Id of the customer account a store reviewer signs in as.                   |
| `EMAIL_CODE_REVIEW_CLIENT_ID`  | The native application that takes the fixed review code.                   |
| `EMAIL_CODE_REVIEW_CODE_HASH`  | bcrypt hash of the fixed six-digit review code.                            |
| `EMAIL_CODE_REVIEW_UNTIL`      | ISO timestamp that ends review access, at most 30 days after the start-up. |

The four review settings go together. The server refuses to start with one to
three of them set, or with an end more than 30 days ahead.

A code never outlives the sign-in attempt it belongs to. An attempt lasts
fifteen minutes, so a lifetime longer than that has no effect.

Mail goes through the SMTP settings every other mail uses.

<!-- feature:email-password:start -->

For SMTP setup, see [setup-smtp.md](setup-smtp.md).

<!-- feature:email-password:end -->

## The native application key

Each native application in `AUTH_NATIVE_APPLICATIONS` opts in with
`signIn.emailCode`:

```json
{
  "clientId": "mobile",
  "signIn": { "emailCode": true, "emailLink": true }
}
```

The application offers `emailCode` as a first factor only while both
`EMAIL_CODE_ENABLED` and `signIn.emailCode` are on. The methods reply then has
`capabilities.emailCode` set to `true`, and a new sign-in attempt lists
`emailCode` among its factors. An application whose only key is `emailCode` can
start an attempt. While email code is off the reply leaves the key out.

Turn email code on for an application only once its app is built with the
updated SDK, because older builds refuse a methods reply with the extra key.

With `signIn.emailLink` on as well, and `MAGIC_LINK_ENABLED` on, the mail also
carries the button. Leave either off and the mail carries the code alone.

## In the app

The sign-in screen offers "Email me a sign-in code" while the methods reply has
`capabilities.emailCode`. It is then the app's only email choice: the separate
link choice goes, because the code mail carries the button whenever the
application has the email link too.

- The app sends its language with the address and the code, so the mail and any
  account the code creates use that language.
- The code screen takes the six digits. Digits a keyboard types in another
  script are read as Western digits before anything is sent.
- A wrong, expired or already used code leaves the screen open and says so.
  Asking for another mail keeps the same attempt: the new mail replaces the code
  and the link, and wrong guesses keep counting.
- When the server ends the attempt after five wrong codes, the app says so and
  offers to start again.
- The button in the mail, opened on the phone that asked, finishes the same
  attempt, also while the code screen is open. The app reads its values after
  `#`.
- Closing and reopening the app keeps the attempt. The code screen comes back
  once the methods reply arrives, and the code still works.

## Routes

Both routes take the attempt secret in the `X-Native-Attempt` header and answer
as a disabled feature while email code is off for the server or the
application.

| Method | Path                                                      | What it does                                                             |
| ------ | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| POST   | `/api/auth/native/attempts/:attemptId/email-code/request` | Takes `email`. Mails a code for this attempt, and a link when on         |
| POST   | `/api/auth/native/attempts/:attemptId/email-code/verify`  | Takes `code`, six Western digits. Moves on to a second factor or consent |

The request answers the same for a known address, an unknown one, sign-up
closed, the mail limit reached, a failed send and a deactivated account.
Anything particular to the account is said only after a correct code. A
resend on the same attempt replaces its code and its link. Spending the code
voids the link, and spending the link voids the code.

## Limits

- Five sign-in mails per address in an hour, shared with the email link. Past
  that nothing is sent and the code made for the request is stored already
  spent.
- Five wrong guesses end the attempt. They count on that attempt alone, so they
  never lock the address and a new attempt works at once.
- The per-caller throttles of the email link routes apply.

[`backend/docs/registration-limits.md`](../../backend/docs/registration-limits.md)
explains what an attacker can still do with these limits.

## Access for app store reviewers

An app with no password has no password to give a store reviewer. Review
access names one customer account and one native application. On that
application the account's current address takes a fixed code, and no mail is
sent for it. The code has six digits like any other, so the app needs no
special screen.

Store a bcrypt hash of the code, never the code itself. From `backend/`:

```bash
node -e "require('bcrypt').hash(process.argv[1], 12).then(console.log)" 246810
```

Every use checks again that the account still has that id, is not
deactivated, has no staff role and no permission of its own, and that
`EMAIL_CODE_REVIEW_UNTIL` has not passed. The end takes effect without a
restart. On any other application, or at any other address, nothing changes.

Each sign-in through it records `email_code_review_signed_in`. Five wrong codes
for the account in one UTC day, from any attempts, switch review access off
until the next day and record `email_code_review_locked`. Removing the settings
voids the codes already handed out. The server logs a warning at start-up while
the settings are set.

## The mail

The mail is in the account's language, or the request's for an unknown
address. It holds the code as text in Western digits, the code again in the
subject, how many minutes are left, and a line telling the person to ignore it
if they did not ask.

The button, when there is one, opens the app's registered callback with its
values after `#`. A browser that opens it without the app sends none of them to
a web server, and nothing is spent.

Arabic mail keeps the code in Western digits, the same as English. <!-- feature:locale-ar -->

## Magic link switched off

Email code does not need `MAGIC_LINK_ENABLED`. It shares the account store and
the mail counter with the magic link, which every project with email code
carries, but with the magic link switched off it still mails codes and signs
people in. Only the button goes, and the email link routes keep answering as a
disabled feature.

## Mail delivery

There is no durable mail queue. The server answers first and sends the mail in
the same process afterwards, trying up to three times in a row. If every try
fails, or the server stops or restarts in between, the mail is lost and nothing
sends it later. The person sees the usual reply and no mail, and can ask for a
new code.

## Proof of an action

The core `proofCode` mail and `FreshProofSender` do not depend on this feature
and remain in a project generated without it. Plan 4 supplies how a proof is
issued and spent. No route sends that mail today.
