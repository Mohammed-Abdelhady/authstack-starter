# Upgrade notes

## Browser application origins

A signed-in browser read from an unlisted origin now gets HTTP 403 with
`ORIGIN_REJECTED`. This includes GET requests and public endpoints. The server
refuses the request before its handler runs, even if the browser sends
`Sec-Fetch-Site: same-site`.

Set `CLIENT_URL` to the exact web origin. If a separate admin site uses the API,
set `ADMIN_URL` to its distinct origin. Update browser callers that use another
origin. CORS headers alone no longer determine whether a cookie-bearing request
is accepted. Requests without `Origin` still fall back to web; `Referer` never
selects admin.

This refusal applies even when none of the new browser application settings is
configured.

At each startup, the web application's stored allowed origins are replaced with
the normalized `CLIENT_URL` origin. A configured admin application gets the
normalized `ADMIN_URL` origin in the same way. Any origins added by hand to those
rows are removed. Set these settings to the browser origins before restarting.

## Persisted web application availability

An absent `AUTH_WEB_ENABLED` preserves the stored web application state. A new web
application starts enabled. Setting `AUTH_WEB_ENABLED=false` persists a disable;
removing the setting keeps web disabled. To enable it again, explicitly set
`AUTH_WEB_ENABLED=true`. Guards, CORS, session issuance and validation use the stored state.

## Browser policy versions

Changes to the admission snapshot or configured method list advance the
application policy version. Changing server-wide method availability does not.
The reserved browser `emailCode` key is excluded from the method snapshot;
changing it alone never ends sessions until a browser route enforces it.

`AUTH_ADMIN_SIGN_IN` now requires `ADMIN_URL`. Startup refuses an admin policy
without an admin address rather than silently ignoring it.

## Closed self sign-up

`signUp: "closed"` now refuses password activation, magic-link account creation
and provider account creation. Existing accounts can still sign in and staff
creation remains allowed. Registration and activation resend return their usual
generic reply without mailing either known or unknown addresses. Magic-link
requests keep the same reply and mail behavior for both; following a link cannot
create an account on a closed application. Provider creation returns the existing
provider-authentication-failed reply. No rejected creation is committed. An
application with `requirePasskey: true` refuses self sign-up in the same way,
because no sign-up method gives a new account its first passkey.

New accounts with an audience must match their assigned role's audience. A
self-sign-up audience that differs from the default role is refused, even on an
open application. Configure the default role deliberately before enabling
application audiences.

## Enable account audiences after mapping existing data

Apply the schema migrations first and keep application audience settings absent.
Stop the API, build the backend in a source checkout, then inspect the migration
with:

```text
pnpm --filter backend run build
pnpm --filter backend run audience:apply --dry-run
```

Map each custom role without an audience explicitly and repeat the dry run:

```text
pnpm --filter backend run audience:apply --dry-run --role editors=customer --role operators=staff
pnpm --filter backend run audience:apply --role editors=customer --role operators=staff
```

The production command runs `node dist/cli/audience-apply.js` and needs no
development dependencies. In a source checkout, `audience:apply:dev` runs the same
command from TypeScript. The command's E2E cases run that TypeScript entry too, so
they need no build; the backend build checks that the compiled entry exists.

For the shipped image, keep the database running and use a one-off backend
container while the API is stopped:

```text
docker compose -f docker-compose.prod.yml stop backend
docker compose -f docker-compose.prod.yml run --rm --no-deps backend node dist/cli/audience-apply.js --dry-run
docker compose -f docker-compose.prod.yml run --rm --no-deps backend node dist/cli/audience-apply.js
```

Add the required `--role` mappings to both container commands. Use
`docker-compose.postgres.prod.yml` instead for PostgreSQL. The image already
contains the compiled command and production dependencies.

Core `admin` becomes `staff` and core `user` becomes `customer`. Host role mappings
come from `HOST_ROLES`; custom role names and permissions are never interpreted
as audiences. The command refuses missing or conflicting mappings before writing,
fills only absent audiences, and ends each changed account's sessions in the
transaction that maps it. Customer mappings with direct or inherited wildcard or
`:staff` grants are refused; repair those grants explicitly before retrying. Reruns
leave already mapped data and session authority unchanged.

Every refusal is checked, and the role mappings commit, in one transaction before
any account changes. Each account then gets its own transaction, so a large installation stays
within the database's transaction limits. If the command stops part way, the
accounts it mapped keep their audience and their ended sessions; run it again to
map the rest.

After the command succeeds, configure application audiences and restart. Startup
refuses to serve when any role or account still lacks an audience. Without an
application audience, the mapping check, audience authorization and staff guard
remain inactive.

## Role audience choice in the web console

The role creation dialog now offers an optional audience even when no application
names one. Existing browser metadata endpoints do not expose whether audience
mode is active, so the selector remains visible. Leaving it unset preserves the
legacy behavior. Choosing an audience stores immutable role metadata; it does not
activate audience mode. Choose deliberately before enabling application audiences.

## Task 0.6b, reserved permission grants

The five `users:list:staff`, `users:read:staff`, `users:update:staff`,
`users:delete:staff` and `users:create:staff` permissions are now active. When an
application names an audience, these cover staff targets and `:all` covers
customer targets. With no application audience configured, the five `:staff`
permissions can be granted but authorize no route action; use the existing `:all`
permissions until audience mode is enabled.

The role and account permission routes still refuse new grants of these reserved
permission strings:

- `users:suspend:all`
- `users:suspend:staff`
- `activity:read:all`
- `sessions:read:staff`
- `sessions:delete:staff`

A role that already holds one of these permissions keeps it and can retain it
when updated. New role grants and direct account grants are refused.

If your host application uses one of these strings for its own meaning, rename it
before upgrading. Update its stored grants and permission checks to use the new
name.

## Live session limits

Browser `AUTH_WEB_SESSION` and `AUTH_ADMIN_SESSION` settings now apply to existing
sessions on validation. An admin setting above 8 absolute hours, 15 idle minutes
or a cap of 5 refuses startup and names the setting. A configured cap is per
application; absent settings retain the global cap of 20 and admin cap of 5.
Lifetime changes do not advance the admission-policy version. Removing a browser
setting restores its default lifetimes and cap fallback at startup: web uses
168 hours and 30 minutes, admin uses 8 hours and 15 minutes.

Validation attempts to persist observed expiry with reason `expired`, including
for default limits. If that write fails, the expired cookie keeps its usual
signed-out response and its next use retries persistence. Once the ending is
stored, increasing a limit cannot revive the session. Existing stored absolute
deadlines remain upper bounds after increasing settings.

Native bound/unbound settings are available to the shared limit selector. Each
unbound limit must be no longer than its bound limit. The initial idle window
stays at most 5 minutes even with configured limits. Native issue, exchange,
refresh and retry integration is not yet complete. Retain the
existing native limits until those paths are verified.

## Deploy the native link host at both boundaries

An absent `AUTH_NATIVE_LINK_HOST` adds no backend responses or nginx virtual host.
When setting it, use a hostname distinct from the API, web and admin hostnames.
Production first-party redirects must use HTTPS on that host. Association output
includes only applications with the identifiers required by that platform.

Regenerate the nginx include from the backend's effective configuration whenever
native redirects, localized/custom mail templates or the host setting change.
Mount the generated directory into the shipped proxy and supply a certificate
covering the hostname. Removing the setting also requires regenerating and
reloading the include. See [application setup](setup/setup-applications.md#native-link-host).

The link host proxies only exact association and effective mail/redirect paths.
It serves no API, documentation, health or frontend assets. `Host` is the boundary;
forged forwarded-host headers cannot select it. Do not replace its exact
locations with a prefix proxy or frontend fallback. The sole HTTP-only disk
exception is ACME HTTP-01 under `/.well-known/acme-challenge/`; it never proxies
to the application and is unavailable on HTTPS. Expand the existing certificate
with all current SANs plus the link hostname, using the documented
`--entrypoint certbot` issuance command. Deploy renewed files into `nginx/ssl`
and validate/reload nginx; the renewal loop alone does not update that copied
mount. Run the documented
[real nginx gate](operations/native-link-proxy-gate.md) before deployment.
