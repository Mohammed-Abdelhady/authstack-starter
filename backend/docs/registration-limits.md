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
