# Registration limits and residual denial of service

The new registration contract removes account pre-hijacking: no credential is
stored before the address is proved. It does not remove denial of service
against an address. This note records what is limited, what an attacker can
still do, and what the owner sees, so a later change to the limits is a
deliberate one.

## The limits

The mail window is derived from the configured code lifetime
(`ACTIVATION_CODE_EXPIRES_IN`, default `ACTIVATION_CODE_EXPIRES_IN_DEFAULT` =
900000 ms) but floored at `MAILED_CODE_WINDOW_MIN_MS` = 15 minutes. So the
window is `max(code lifetime, 15 minutes)`; a one-minute lifetime still counts
mails over fifteen minutes.

Each per-address counter lives in its own `mailcounters` document, keyed by
address and purpose, with its own `windowStartedAt`. It is separate from the
code record, so deleting an expired record — by a failed verification, a
resend, or the TTL index on the record — cannot reset the count.

| Limit                                           | Value                              | Where                                             |
| ----------------------------------------------- | ---------------------------------- | ------------------------------------------------- |
| Sign-up codes mailed per address                | 5 per window                       | `MAILED_CODE_LIMIT_PER_ADDRESS`, purpose `signup` |
| Email-change codes mailed per address           | 5 per window                       | same cap, purpose `email-change`                  |
| Registration-attempt notices mailed per address | 5 per window                       | same cap, purpose `notice`                        |
| Password-reset codes mailed per address         | 5 per window                       | same cap, purpose `password-reset`                |
| Attempts on one activation code                 | 5                                  | `activation.maxAttempts`                          |
| Wrong codes per address and purpose             | 5, then a lock                     | `CODE_GUESS_LIMIT`, `CODE_GUESS_RULE`             |
| Per-caller route throttles                      | see `common/constants/throttle.ts` | `@Throttle`                                       |

The four counters are independent, so one address can receive at most 20 mails
in a window (5 + 5 + 5 + 5). Magic-link mail is outside these counters: it has
its own per-address hourly cap, `magicLink.maxPerHour`.

A refresh always issues a code with a full code lifetime ahead, so a mailed
"expires in N minutes" matches the configured lifetime.

## What an attacker can still do

Knowing only an address, an attacker can:

1. Register it five times to reach the sign-up mailed-code cap.
2. Submit five wrong activation codes against the latest code, spending the
   attempt limit and locking it.

A new code does not buy new guesses. Wrong codes are counted at the address and
purpose, across every code the address was mailed, for sign-up, email-change
and password-reset codes alike. The fifth guess is the last one. After it no
code for that address and purpose is accepted for 15 minutes, a right one
included, and the answer is the same as for a wrong code. Each lock that
follows doubles: 30 minutes, an hour, and so on up to a day. A right code
forgets the count and the locks. So do 24 hours without a wrong code or a lock.

That leaves an attacker 35 guesses in the first day and 5 a day after that,
against 900,000 possible codes. Before this rule it was 25 guesses per mail
window, 2,400 a day.

A guess at an address that has no live code is not counted. The count sits on
the address's mail counter row and is independent of the mail cap: a locked
address is still mailed, and a full mail cap does not lock guessing.

After that the owner's own register and resend for that address mail nothing
until the mail window rolls over. The code stays locked, and so does the
address until its lock ends. The attacker cannot
choose, learn or set the password or name, and cannot sign in; the damage is a
delay, repeatable once per window. The plan accepts this residual denial of
service. The route throttles are per client IP, but a single IP is enough to
spend the per-address cap and lock the code, so the accepted lock-out does not
need a distributed caller.

## Cost of the two address states

A register for a free address writes the mail counter and the pending record,
one to three writes after the code hash. A register for an existing live
account writes only the notice counter; a soft-deleted address writes nothing.
The difference is sub-millisecond and sits behind the per-caller throttle, so
it is not a usable signal.

## What the owner sees

The generic reply ("If an account exists, a code has been sent") on every
address request, and no mail while the cap or the lock is in force. The owner
cannot tell the cap apart from a missing account, by design. Once the window
rolls over, register or resend mails a fresh code again.

<!-- feature:email-code:start -->

## Sign-in codes for native apps

A sign-in code belongs to one native attempt, never to an address. Its wrong
guesses are counted on that attempt's row. The fifth wrong guess spends the
code and ends the attempt. It never locks the address and never touches
another attempt, so a new attempt for the same address works at once. A resend
on the same attempt keeps the count it has. Cleanup keeps the row until the
attempt ends, not the code, so a code that expired while its attempt lives
leaves the attempt's wrong guesses in place for the next code.

| Limit                            | Value                              | Where                                        |
| -------------------------------- | ---------------------------------- | -------------------------------------------- |
| Sign-in mails per address        | 5 per hour                         | `magicLink.maxPerHour`, shared with the link |
| Wrong guesses per attempt        | 5, then the attempt ends           | `EMAIL_CODE_GUESS_LIMIT`                     |
| Wrong guesses per address        | 100 a UTC day, then no code mailed | `ADDRESS_GUESS_CEILING`                      |
| Code lifetime                    | 10 minutes, never past the attempt | `EMAIL_CODE_EXPIRES_IN`                      |
| Per-caller requests and verifies | see `common/constants/throttle.ts` | `@Throttle`                                  |

One mail carries both the code and the link, so they share one counter. A
request over the limit, or for an unknown address while sign-up is closed,
mails nothing and stores its code already spent, so no guess can match it. A
deactivated account is mailed like any other, and only its right code is
answered with `FORBIDDEN` instead of a sign-in. The reply to the request is the
same in every case.

What an attacker can still do: knowing only an address, someone can request
codes for it until the hourly limit is reached. For the rest of that hour the
owner's own requests mail nothing, by code or by link. Each mailed code allows
at most five guesses, so a window holds at most 25 guesses against 900,000
codes. Password, passkey and provider sign-in are not affected, and the owner
can sign in again by code once the hour rolls over. The plan accepts this
residual denial of service.

Those guesses would add up across windows, so wrong guesses at live codes are
also counted on the address for the UTC day, from any attempt. NIST SP 800-63B,
section 5.2.2, limits consecutive failed attempts on one account to 100, and
`ADDRESS_GUESS_CEILING` applies that number to each address for each UTC day.
Once an address has 100 in a day, a request still gets the same reply, but its
code is stored already spent and nothing is mailed until the next UTC day. A
guess at a code that is spent, expired or out of guesses does not count. Codes
already mailed keep working, the account is never locked, and password, passkey
and provider sign-in are not affected. The row that counts holds no code and is
kept only until its day ends.

That leaves an attacker 100 guesses a day against 900,000 codes, about a 0.011%
chance a day of signing in as the account, about 0.33% over 30 days and about
4% over a year, because the count starts again each day. The price is a longer
denial of service. Someone who keeps the hourly limit full and guesses wrong at
every code reaches the ceiling in four hours, 25 guesses an hour. One caller is
enough, because the per-caller throttles allow five requests and ten verifies
in fifteen minutes, and starting an attempt falls under the default limit of 60
requests a minute. From then until the UTC day ends the owner is mailed no
code. The email link route does not read the ceiling, but it shares the hourly
limit the attacker keeps full. The owner receives every code the attacker asks
for, five an hour, which is the only sign of the attack. The plan accepts this
residual denial of service.

Delivery has no durable queue. The server answers first and sends the mail in
the same process afterwards, trying up to three times in a row. If every try
fails, or the server stops or restarts before the send finishes, the mail is
lost and nothing sends it later. The reply still looked like success, so the
person sees no error and asks again, which costs one of the five mails in the
window.

### Access for store reviewers

With the four `EMAIL_CODE_REVIEW_*` settings, one customer account takes a
fixed code on one application and is mailed nothing. A fixed code can be
guessed from any number of attempts, so its wrong guesses also count on the
account for the UTC day. The fifth one of the day switches review access off
until the next day and records `email_code_review_locked`. After that even the
right fixed code is refused, and the address is mailed codes like any other.
Each attempt still ends after five wrong guesses of its own, and each review
request still takes one of the address's five mails an hour, so a request past
that limit stores the fixed code already spent.

<!-- feature:email-code:end -->
