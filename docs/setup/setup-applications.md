# Applications Setup Guide

Used from plan 1. Today the existing application registry and session constants remain in use. Reserved policy values are validated but no route or guard reads them.

## Reserved settings

| Setting                 | Reservation                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `ADMIN_URL`             | Used from plan 1. Optional admin origin, distinct from CLIENT_URL.                 |
| `AUTH_WEB_ENABLED`      | Used from plan 1. Reserved web application switch. Default `true`.                 |
| `AUTH_WEB_SIGN_IN`      | Used from plan 1. Optional method flags and signUp, requirePasskey, audience JSON. |
| `AUTH_ADMIN_SIGN_IN`    | Used from plan 1. Optional method flags and signUp, requirePasskey, audience JSON. |
| `AUTH_WEB_SESSION`      | Used from plan 1. Optional absoluteHours, idleMinutes, cap JSON.                   |
| `AUTH_ADMIN_SESSION`    | Used from plan 1. Optional absoluteHours, idleMinutes, cap JSON.                   |
| `AUTH_NATIVE_LINK_HOST` | Used from plan 1. Optional bare hostname for native association links.             |

`AUTH_WEB_SIGN_IN` and `AUTH_ADMIN_SIGN_IN` accept boolean `password`, `emailLink`,
`emailCode` and `passkeys` flags, plus `signUp: "open" | "closed"`, `requirePasskey: boolean` and
`audience: "customer" | "staff"`. Email-code is owned by plan 2. Absent method
settings allow today's server-enabled methods. Absent policy keys mean open
sign-up, no required passkey and unrestricted audience.

Browser session JSON is `{ "absoluteHours": 168, "idleMinutes": 30, "cap": 20 }`.
An absent web setting keeps 168 hours, 30 minutes and cap 20; absent admin
settings keep 8 hours, 15 minutes and cap 5. Readers apply these defaults.

Native application reservations are application-level `signUp`, `audience`,
`requirePasskey`, `session`, `firstParty`, `appleAppId`, `androidPackage` and
`androidCertificates`, plus `signIn.emailCode` from plan 2. Native `session`
has `bound` and `unbound` objects, each with `absoluteHours` and `idleMinutes`.
Absent profiles keep 720 hours and 10080 minutes, with the existing cap 20.
Absent `firstParty` means false; signing identifiers remain absent.
No new defaults are written into parsed native applications.
