# Applications Setup Guide

`CLIENT_URL` names the web application. Set `ADMIN_URL` when a separate admin
site uses the same API. Its origin must differ from `CLIENT_URL`; in production
it must use HTTPS on a public host. For example, use `https://app.example.com`
and `https://admin.example.com`, with the API at `https://api.example.com`.

## Browser settings

| Setting              | Behavior                                                                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN_URL`          | Enables selection of the admin browser application from its exact Origin.                                                                                                                                              |
| `AUTH_WEB_ENABLED`   | Writes web availability when set. Absent settings preserve stored availability; a new web application starts enabled. `false` refuses web browser requests and session issuance, and removes the web origin from CORS. |
| `AUTH_WEB_SIGN_IN`   | Optional JSON flags for the web application and its admission policy snapshot.                                                                                                                                         |
| `AUTH_ADMIN_SIGN_IN` | Optional JSON flags for the admin application and its admission policy snapshot. Requires `ADMIN_URL`.                                                                                                                 |

Setting `AUTH_WEB_ENABLED=false` persists the disabled state. Removing the setting
keeps web disabled. Set `AUTH_WEB_ENABLED=true` explicitly to enable it again.
Guards, CORS, session issuance and validation read the stored availability.

An absent method setting allows every method enabled by the server and included
in the generated project. A per-application `true` cannot enable a server-disabled
method. Providers are not filterable per application: both browser applications
allow every enabled OAuth provider.

For example, to disable password sign-in in admin while retaining enabled OAuth
providers and passkeys:

```text
AUTH_ADMIN_SIGN_IN={"password":false,"passkeys":true}
```

Method flags are `password`, `emailLink` and `passkeys`. `emailCode` is accepted
as a reserved key until a browser route enforces it. It is excluded from the
browser method snapshot and changing it alone never ends sessions.
Policy keys are `signUp: "open" | "closed"`,
`requirePasskey: boolean` and `audience: "customer" | "staff"`. Missing policy
keys mean open sign-up, no required passkey and unrestricted audience. A staff
application must specify `signUp: "closed"`; `requirePasskey: true` requires
passkeys to be available for that application. Startup names the invalid setting
and its repair.

Audience admission and target scopes activate when any application names an
audience. The staff browser guard activates only when an application names
`staff`. Closed sign-up refuses new self-created accounts. Staff account creation
and seed bootstrap remain allowed. Required-passkey issuance enforcement lands in
sub-wave 5; do not rely on that key before that change.
A real change to the admission snapshot or configured method list
advances the application policy version and records `policy_changed` in the same
transaction. Changing server-wide method availability does not advance this version.
Existing sessions with an older policy version are refused on their next use.
Restarting with unchanged policy does neither. Lifetime changes do not advance
this version.

## Request and cookie selection

A verified OAuth or magic-link ceremony supplies its application. Other browser
requests use an exact `Origin` match against the configured web and admin
origins, then fall back to web. Missing `Origin` never selects admin, and
`Referer` never selects it. The legacy OAuth navigation start always means web;
frontends use the POST start endpoint to select from Origin.

The API allows the enabled web/admin origins through CORS, includes credentials
and caches preflight responses for 600 seconds. Any request carrying a recognized
session cookie and an unlisted Origin receives 403 before public-route and
safe-method bypasses. See [upgrade notes](../upgrading.md).

Web and admin sessions remain independent. Secure deployments use `__Host-sid`
and `__Host-sid-admin`; local HTTP uses `sid` and `sid-admin`.
`SESSION_COOKIE_NAME` overrides the web name only. Challenge and browser-proof
cookies are separate per application too. Identity, CSRF reads and sign-out use
only the selected application's session. A copied cookie cannot change its
stored application.

## Account audiences

Use `audience: "customer"` or `audience: "staff"` in an application's sign-in
policy. A named audience admits only accounts of that audience. An application
without an audience admits either. Browser admission is live; native admission
lands with the native sign-in integration in sub-wave 4. With no application
naming an audience, audience admission and the staff guard stay inactive.

Before naming an audience on an existing installation, stop the API and run
`pnpm --filter backend run build`, then
`pnpm --filter backend run audience:apply --dry-run`. The command runs compiled
JavaScript and is also available in the production image. In a source checkout,
`audience:apply:dev` runs it directly from TypeScript. See the container commands
in [upgrade notes](../upgrading.md). Core `user` maps to
`customer`; core `admin` maps to `staff`, including customer-only deployments.
Host roles use their audience in `HOST_ROLES`. Supply each unmapped custom role
explicitly, for example `--role editors=customer --role operators=staff`, then
run again without `--dry-run`. The command fills missing audiences, ends sessions
of changed accounts atomically with the mapping, and refuses conflicting
existing mappings. Rerunning an applied mapping changes nothing. Startup reports
unmapped account and role counts and refuses named audience configuration.

Self-sign-up reads its stored application's audience in the creating transaction.
An unrestricted application uses `customer` when another stored application names
an audience, and stores no audience when none does. Staff-created
accounts use their assigned role's audience. Seeds keep their bootstrap exemption.
Role audiences are immutable; account role changes must stay within the account's
audience. Creating a role while audiences are active requires an explicit
audience; select it in the role creation dialog or include it in the API request.
The optional selector stays visible when audience mode is inactive. Leaving it
unset retains legacy behavior; selecting a value stores immutable metadata and
does not enable audience mode.
Direct wildcard and `:staff` grants require a staff account. Customer role
definitions cannot carry those grants.

When any application names `staff`, staff routes additionally require a full
browser session from the `admin` application and a staff account. Native sessions
and enrolment sessions cannot pass that guard. Customer `:all` permissions do not
include staff accounts; staff scope or the wildcard is required for those accounts.
The five `users:*:staff` permissions grant no route action until an application
names an audience; while inactive, continue using the existing `:all` grants.
Configure `ADMIN_URL` to provide that browser application. When admin requires a
passkey, the session must contain server-verified passkey evidence with user
verification.

## Settings completed in later sub-waves

`AUTH_WEB_SESSION` and `AUTH_ADMIN_SESSION` accept
`{ "absoluteHours": 168, "idleMinutes": 30, "cap": 20 }`. Their live-limit
behavior lands separately. Absence keeps today's web lifetime and global cap,
with the existing lower admin cap.

`AUTH_NATIVE_LINK_HOST` and native application policy, session and signing
identifiers are completed with the native and link-host work. Native `session`
has `bound` and `unbound` objects, each with `absoluteHours` and `idleMinutes`.
Absent `firstParty` means false; signing identifiers remain absent.
