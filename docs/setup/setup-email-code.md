# Email Code Setup Guide

A native app can sign a person in with a six-digit code mailed to their
address. The person types the code into the app on any device. When the
application also has the email link, the same mail carries a button that
finishes the same sign-in on the phone that asked. An unknown address becomes an
account when the application lets people sign up.

This guide covers the server side. The app screens arrive with plan 2.3, and
access for app store reviewers with plan 2.4. Until then the review settings
below are parsed and used by nothing.

## Settings

| Setting                        | Meaning                                                                  |
| ------------------------------ | ------------------------------------------------------------------------ |
| `EMAIL_CODE_ENABLED`           | Turns email-code sign-in on for the server. Default `false`.             |
| `EMAIL_CODE_EXPIRES_IN`        | Code lifetime in milliseconds. Default `600000`, ten minutes.            |
| `EMAIL_CODE_REVIEW_ACCOUNT_ID` | Plan 2.4. Review account. Parsed today, not used.                        |
| `EMAIL_CODE_REVIEW_CLIENT_ID`  | Plan 2.4. Review application. Parsed today, not used.                    |
| `EMAIL_CODE_REVIEW_CODE_HASH`  | Plan 2.4. Digest of the fixed review code. Parsed today, not used.       |
| `EMAIL_CODE_REVIEW_UNTIL`      | Plan 2.4. ISO timestamp that ends review access. Parsed today, not used. |

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
