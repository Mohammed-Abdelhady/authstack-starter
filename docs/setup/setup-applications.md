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
passkeys to be available for that application, and startup names the
application and its repair when they are not. With it on, only a passkey sign-in
that verified its user, with a PIN or a biometric, is let in. A browser passkey
belongs to its application's relying party: the web one is `WEBAUTHN_RP_ID` and
`WEBAUTHN_ORIGIN`, and the admin one is the host and origin of `ADMIN_URL`.

Audience admission and target scopes activate when any application names an
audience. The staff browser guard activates only when an application names
`staff`. Closed sign-up refuses new self-created accounts. A required passkey
refuses them too, the same way: password, link and provider sign-up cannot give
a new account its first passkey. Staff account creation
and seed bootstrap remain allowed. The issuer enforces required-passkey policy
from the evidence the passkey sign-in records on the session.
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
without an audience admits either. Browser admission is live. Native attempt
and credential-path integration is not yet complete; do not treat configured
native policy as proof that every native flow enforces it. With no application
naming an audience, audience admission and the staff guard stay inactive.

Before naming an audience on an existing installation, stop the API and run
`pnpm --filter backend run build`, then
`pnpm --filter backend run audience:apply --dry-run`. The command runs compiled
JavaScript. In a source checkout, `audience:apply:dev` runs it directly from TypeScript.
The production image carries it too; see the container commands in [upgrade notes](../upgrading.md). <!-- feature:production -->
Core `user` maps to `customer`; core `admin` maps to `staff`, including customer-only deployments.
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

## Session limits

`AUTH_WEB_SESSION` and `AUTH_ADMIN_SESSION` accept JSON containing all three
fields, for example:

```text
AUTH_WEB_SESSION={"absoluteHours":168,"idleMinutes":30,"cap":20}
AUTH_ADMIN_SESSION={"absoluteHours":4,"idleMinutes":10,"cap":3}
```

| Application | Initial absolute limit | Initial idle limit | Absent cap                                |
| ----------- | ---------------------- | ------------------ | ----------------------------------------- |
| Web         | 168 hours              | 30 minutes         | Existing global cap of 20                 |
| Admin       | 8 hours                | 15 minutes         | Existing admin cap of 5, within global 20 |

Without a browser session setting, the application uses the initial limits
above. Removing the setting restores those lifetimes and the global cap fallback
at startup.

Admin settings cannot exceed 8 hours, 15 minutes or 5 sessions. Startup refuses
an above-bound value and names `AUTH_ADMIN_SESSION`. A configured `cap` counts
sessions for that application. When no cap is configured, the existing global
cap of 20 and lower admin cap of 5 still apply.

Limits apply to existing sessions at their next validation. Shortening a limit
can end a session immediately. Expiry is persisted with reason `expired`. Once
that ending is stored, lengthening the limit cannot revive the session. If the
write fails, the expired credential still receives the usual signed-out reply;
its next use retries the write. A longer limit cannot extend a session past the
absolute deadline stored when it was issued.
Lifetime and cap changes do not advance the application policy version.
Enrolment keeps its separate fixed 15-minute lifetime. These are server limits.
`SESSION_COOKIE_MAX_AGE` still controls browser-cookie persistence and can end
browser access earlier.

A native application accepts `session.bound` and `session.unbound`, each with
`absoluteHours` and `idleMinutes`. The unbound pair applies when the session has
no device-key binding. Each unbound limit must be no longer than its bound
limit. Absent settings retain 30 days absolute and 7 days idle. Every new native
session starts with an idle window of at most 5 minutes, including when limits
are configured; a shorter configured idle wins. The shared limit selector is
available, but native issue, exchange, refresh and retry paths
still need their integration. Do not enable custom native limits expecting
complete enforcement until that work is verified.

## Native link host

Set `AUTH_NATIVE_LINK_HOST` to a bare hostname, for example `links.example.com`.
It must differ from the hostnames in `API_URL`, `CLIENT_URL` and `ADMIN_URL`.
In production, a first-party native application's redirect must use HTTPS on
this link host. An absent setting adds no link-host responses.

The backend serves these exact association paths on that host, as JSON without
a redirect:

- `/.well-known/apple-app-site-association`, for applications with `appleAppId`.
- `/.well-known/assetlinks.json`, for applications with both `androidPackage`
  and `androidCertificates`.

Use the signed application's identifiers and SHA-256 signing-certificate
fingerprints. These identifiers are public association data. Applications
without the required identifiers are omitted from that platform's file.

Native redirect paths and the paths in effective mail-link templates, including
custom and localized templates, serve a fixed page that tells the reader to
continue on the requesting phone or use the mailed code. It has no script,
echoes no request data, and sends `noindex`, `Referrer-Policy: no-referrer` and a
CSP containing `script-src 'none'`. The language is selected from the project's
supported languages. API routes, documentation, health and frontend assets are
unavailable on the link host. Passkey origins remain exact, with no domain
wildcard.

A proxy in front of the backend needs the same boundary.
`node dist/cli/native-link-host.js --proxy-manifest` prints, as JSON from the
validated configuration, the link host, the exact paths to pass to the backend and
the namespaces to refuse.

<!-- feature:production:start -->

### Configure the shipped proxy

The nginx files use static `server_name` directives. `setup-production` rewrites
the frontend and API names; `NGINX_HOST` is not an nginx template substitution.
The link-host renderer receives a manifest exported by the backend's validated
effective configuration. It does not parse an environment file itself.

Build the backend or use its production image, then generate the include
atomically from the same configuration that will run the API:

```bash
set -euo pipefail
mkdir -p nginx/native-link-host
chmod 755 nginx/native-link-host
pending="$(mktemp nginx/native-link-host/link-host.XXXXXX)"
trap 'rm -f "$pending"' EXIT
docker compose -f docker-compose.prod.yml run --rm --no-deps backend \
  node dist/cli/native-link-host.js --proxy-manifest \
  | node nginx/render-native-link-host.mjs > "$pending"
chmod 644 "$pending"
mv "$pending" nginx/native-link-host/link-host.conf
trap - EXIT
```

Use `docker-compose.postgres.prod.yml` for PostgreSQL. <!-- feature:database-choice -->
With no configured link host, the renderer emits an empty include. Regenerate it
when the host, native redirects or mail templates change, including when removing
the setting.

Add this mount in a local Compose override, `compose.link-host.yml`:

```yaml
services:
  nginx:
    volumes:
      - ./nginx/native-link-host:/etc/nginx/native-link-host:ro
```

The generated servers use the existing container ports 8080 and 8443, published
as 80 and 443 by Compose. Permitted paths proxy to the backend on both HTTP and
HTTPS without redirects. The HTTP server also serves ACME HTTP-01 challenge
files from `/var/www/certbot`, never from an upstream. That exception is absent
on HTTPS. Every other path returns 404; other methods on proxied paths return 405. The servers overwrite `Host` and forwarding headers. The backend boundary
uses raw `Host`, never `X-Forwarded-Host`.

The certificate installed under `/etc/nginx/ssl/` must cover the link hostname.
Point its DNS at the proxy. The shipped `ssl-setup.sh` only requests its domain
and `www` name; it does not add the link host. Expand the existing certificate
lineage explicitly. Replace the example certificate name, email and **all**
existing DNS names below with those in your installation, retaining every
current SAN and adding `-d links.example.com`:

```bash
docker compose -f docker-compose.prod.yml -f compose.link-host.yml run --rm \
  --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
  --email ops@example.com --agree-tos --no-eff-email \
  --cert-name example.com --expand \
  -d example.com -d www.example.com -d api.example.com -d links.example.com
```

The nginx service must already serve the shared webroot on port 80. The explicit
entrypoint bypasses the Compose certbot service's renewal loop so this command
actually runs `certonly`. Later renewal uses the expanded lineage and the same
HTTP challenge exception. The renewal loop updates `/etc/letsencrypt`; it does
not replace the copied files mounted from `nginx/ssl`. Install the issued or
renewed files there through your existing certificate deployment procedure,
then validate and reload nginx. Keep both Compose files in the deployment:

```bash
docker compose -f docker-compose.prod.yml -f compose.link-host.yml up -d --build nginx
docker compose -f docker-compose.prod.yml -f compose.link-host.yml exec nginx nginx -t
docker compose -f docker-compose.prod.yml -f compose.link-host.yml exec nginx nginx -s reload
```

The optional include glob preserves current proxy behavior when no generated
server block is present. The renderer refuses path lists that overlap API,
documentation, health or frontend asset namespaces, or contain ambiguous URL
escapes. Repair the redirect or mail template and regenerate the include.

Run the separate [real nginx gate](../operations/native-link-proxy-gate.md)
before deploying this boundary. API tests alone do not verify the shipped proxy.

<!-- feature:production:end -->
