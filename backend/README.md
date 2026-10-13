# Backend

NestJS 11 API with MongoDB, cookie-based sessions, dynamic RBAC, two-factor authentication, passkeys, and OAuth.

## Quick start

```bash
pnpm install
pnpm run migration:up     # Apply migrations
pnpm run seed             # Seed roles and test accounts
pnpm run start:dev        # Development server (http://localhost:5000)
pnpm run build            # Production build
pnpm run start:prod       # Production server
```

## Testing

<!-- feature:mongodb:start -->

A unit run starts one MongoDB replica set per Jest worker. Each suite uses its
own database on that worker's server, then drops it during suite cleanup. A
solo run uses up to all but one available CPU. Worker admission estimates
2 GiB of available memory per worker, with at least one worker. If another backend test
command is active, a new command uses one worker and one database instance.

<!-- feature:mongodb:end -->

The PostgreSQL suites start a server of their own and need no database installed. See [Tests on PostgreSQL](docs/database-postgres.md#tests). <!-- feature:postgres -->

Set the unit worker ceiling with `pnpm test -- --maxWorkers=4`. Available memory
may lower that count. The separate
`--maxWorkers 4`, `-w 4`, and percentage forms are also accepted.

The unit suite uses ts-jest isolated-module transpilation. Run
`pnpm run typecheck` separately for full type checking.

<!-- feature:mongodb:start -->

Mongoose decorators cannot infer some TypeScript aliases from decorator
metadata, so give each affected schema property an explicit type, such as
`@Prop({ type: String })`.
<!-- feature:mongodb:end -->

## Tech stack

- **NestJS 11** on Express
- **TypeScript 5.x** with strict mode
- **MongoDB 7** with **Mongoose 8** <!-- feature:mongodb -->
- **PostgreSQL 18** with **Kysely** on the `pg` driver <!-- feature:postgres -->
- **bcrypt** for password hashing
- **Nodemailer** with SMTP transport
- **@simplewebauthn/server** for WebAuthn passkeys
- **Custom OAuth provider registry** for OAuth 2.0 and OIDC

## Project structure

```
src/
├── auth/               # Authentication, sessions, 2FA, passkeys, and OAuth
│   ├── oauth/          # Unified OAuth provider registry and strategies
│   ├── passkeys/       # WebAuthn options and verification
│   ├── services/       # Auth logic
│   └── guards/         # SessionAuthGuard, RolesGuard, PermissionsGuard
├── user/               # User profile and linked account management
├── role/               # Role CRUD and hierarchy
├── admin/              # User administration and direct permission assignment
├── session/            # Session management and device metadata
├── mail/               # Nodemailer email dispatch
├── database/           # Mongoose schemas, migrations, seeds
├── health/             # Health check endpoint
└── common/             # Interceptors, filters, DTOs, and constants
```

## Key environment variables

Configure these in `backend/.env`:

```bash
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb://localhost:27017/authboiler?replicaSet=rs0
CLIENT_URL=http://localhost:3000

# Secrets. The table below has the rule for each
OAUTH_STATE_SECRET=<at least 32 characters>
AUTH_NATIVE_DPOP_NONCE_SECRET=<at least 32 characters>

# SMTP email service
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
EMAIL_FROM=noreply@yourapp.com

# OAuth providers (optional)
OAUTH_GOOGLE_CLIENT_ID=your-client-id
OAUTH_GOOGLE_CLIENT_SECRET=your-client-secret
OAUTH_GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/oauth/google/callback

# Swagger API docs
SWAGGER_ENABLED=true
```

The server checks these when it starts and does not start while one is wrong. `TOTP_ENCRYPTION_KEY` belongs with the secrets above. <!-- feature:totp -->

| Variable                        | Rule                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `MONGO_URI`                     | Required. Starts with `mongodb://` or `mongodb+srv://`                                         | <!-- feature:mongodb -->             |
| `CLIENT_URL`                    | Origin of the web app, used for CORS and for links in mail. `http://localhost:3000` when unset |
| `OAUTH_STATE_SECRET`            | Required, at least 32 characters. `openssl rand -hex 32` makes one                             | <!-- feature:oauth-core,passkeys --> |
| `TOTP_ENCRYPTION_KEY`           | 32 bytes in base64, as `openssl rand -base64 32` prints them. A hex key is refused             | <!-- feature:totp -->                |
| `AUTH_NATIVE_DPOP_NONCE_SECRET` | At least 32 characters, required only with `AUTH_NATIVE_ENABLED=true`                          |

<!-- feature:mongodb:start -->

Sign-in runs in a transaction, so run a single-node replica set locally:

```bash
mkdir -p ./mongodb-data
mongod --replSet rs0 --dbpath ./mongodb-data
```

`mongod` runs in the foreground; leave it running and, in a second terminal:

```bash
mongosh --eval "rs.initiate()"
```

<!-- feature:mongodb:end -->

On PostgreSQL the server needs version 18 or newer, its address in `POSTGRES_URL`, and the migrations applied before the first start. See [PostgreSQL](docs/database-postgres.md). <!-- feature:postgres -->

Set `DATABASE_TYPE=postgres` too. Without it the server runs on MongoDB. <!-- feature:database-choice -->

<!-- feature:docker:start -->

With Docker Compose the backend runs in a container; from the host use `MONGO_URI=mongodb://USER:PASS@localhost:27017/authboiler?authSource=admin&directConnection=true`. The replica set advertises `mongodb:27017`, which only containers on the Compose network can resolve. <!-- feature:mongodb -->

With Docker Compose the backend runs in a container; from the host use `POSTGRES_URL=postgres://USER:PASS@localhost:5432/authboiler`. <!-- feature:postgres -->

The backend image runs `pnpm --filter backend deploy --prod --frozen-lockfile /out/backend`.
pnpm reads registry metadata for the generated lockfile check; package files come
from the store populated by `pnpm fetch`.
<!-- feature:docker:end -->

## Native applications

Set `AUTH_NATIVE_ENABLED=true` to enable native sign-in. Declare clients in
`AUTH_NATIVE_APPLICATIONS` as a JSON array with `clientId`, `displayName`, and
one or more `redirectUris`. `api` is the only scope, and it grants the user's
full permissions: a native access token can do everything the signed-in user
can. `allowedScopes` may be omitted or set to exactly `["api"]`. Any other
list stops the server at startup with an error that names the application,
because no route checks scopes and a narrower list would not narrow access.
When enabled, also set `AUTH_NATIVE_DPOP_NONCE_SECRET` to a random value of at
least 32 characters. Generate one with `openssl rand -hex 32`.
Set `API_URL` to the public origin of this API, the address native clients
call, for example `https://api.example.com`. DPoP proofs are checked against
it, so a wrong value refuses every device-bound exchange, refresh and
revocation. The server does not start with native sign-in enabled unless
`API_URL` is an `http` or `https` origin with no path, query or fragment
(leave out `/api`), and it must be `https` when `NODE_ENV=production`.
Keep `AUTH_NATIVE_DPOP_REQUIRED=false` while clients still use bearer refresh
tokens. Set it to `true` after every supported client can bind tokens with DPoP.

```bash
AUTH_NATIVE_APPLICATIONS='[{"clientId":"com.example.mobile","displayName":"Example Mobile","redirectUris":["com.example.mobile://oauth/callback"]}]'
```

Each client ID must use letters, numbers, periods, underscores, hyphens, or
tildes, and can be at most 128 characters. Redirect addresses use the native
redirect rules. Custom schemes such as the one above are accepted outside
production. In production they are refused, and the server does not start,
unless `AUTH_NATIVE_ALLOW_CUSTOM_SCHEME=true`; it defaults to `false`. HTTPS and
loopback HTTP addresses work either way. HTTP addresses must use a loopback
host, and fragments are rejected.

At startup, the backend reconciles the list for the current environment. It
creates or updates listed clients and disables native clients that are missing
from the list. While native sign-in is enabled, this list is the only source of
truth. An empty or missing list disables every native application in the current
environment. A native application created by hand or by another process is also
disabled at the next start if it is missing from the list. Disabled applications
no longer authorize their existing sessions. Those users must sign in again
after the application is registered and enabled.

The backend does not delete application records. When native sign-in is
disabled, startup ignores this list and does not write native application
records.

Reconciliation runs when the HTTP server starts, not when the application
module is created, so `pnpm run seed` never changes native applications. Every
server process reconciles on boot and the last one to start decides. During a
rolling deploy, start all instances with the same list; a rollback must also
restore the previous list, otherwise the rolled-back server disables the new
clients and signs their users out.

### Device-bound native sessions

DPoP binds a token family to the app's public key. Each refresh and revocation
of a bound family needs a fresh proof from the same key. Refresh and revocation
proofs include a hash of the presented token. A copied refresh token alone
cannot rotate the family. Code running inside the app can still ask the key to
sign, so device binding does not protect a compromised app.

If a refresh response is lost, the same spent refresh token can issue one
replacement within five minutes while its successor pair remains unused. Send a
fresh proof for the retry. The server revokes the first successor pair before
issuing the replacement at the same generation. A spent token cannot issue a
second replacement. If that replacement response is lost, another retry during
the original window returns `invalid_dpop_proof` with
`NATIVE_DPOP_RETRY_IN_PROGRESS`. After the window, or after either successor
credential is used, the server ends the family and the user must sign in again.

`AUTH_NATIVE_DPOP_REQUIRED` is false by default. When true, code exchanges need
a DPoP proof and unbound families cannot refresh. Access tokens remain bearer
credentials for up to five minutes; API requests do not need DPoP proofs. The
token reply says `"token_type":"Bearer"` for a device-bound pair too, and
`Authorization: Bearer <access_token>` is the only scheme the API accepts.

### Native OAuth error shapes

The token, revoke and authorize routes answer failures in three shapes. They
are intentionally not unified, so a client parser must handle all three.

| Shape                | When                                                                 | Status | Body                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OAuth                | Token, revoke and authorize validation and OAuth failures            | `400`  | `{"error":"invalid_grant"}`. When native sign-in is turned off the reason is included: `{"error":"unauthorized_client","error_description":"NATIVE_AUTH_DISABLED"}` |
| Application envelope | Browser authorize actions (read, approve, deny) and other API routes | `4xx`  | `{"success":false,"error":{"code":"NATIVE_TRANSACTION_EXPIRED","message":"..."},"requestId":"..."}`                                                                 |
| Throttling answer    | Any route over the rate limit                                        | `429`  | `{"success":false,"error":{"code":"RATE_LIMIT_EXCEEDED","message":"Too many requests","details":{"retryAfter":60}},"requestId":"..."}`                              |

A token or revoke request with no body, or with a field that is present and
not a string, answers `400 {"error":"invalid_request"}`.

Approve and deny accept an optional `expectedUserId`, the id of the account the
consent page displayed. When it is sent and the browser is now signed in as
another account, the action answers `409` with `NATIVE_AUTHORIZE_ACCOUNT_MISMATCH`
in the application envelope. Nothing changes and the request stays pending, so
the displayed account can still approve or deny it. A value that is not a
string answers `400` with `VALIDATION_ERROR`. Without the field the
action is not checked against an account.

## API endpoints

Every route, who may call it, the setting that closes it and what it does is in [API routes](docs/api-routes.md). Everything sits under `/api` except `/health`.

With `SWAGGER_ENABLED=true` the same routes are browsable at `/api/docs`, with their request and reply shapes.

## Database management

```bash
pnpm run migration:create <name>  # Create migration script
pnpm run migration:up             # Apply pending migrations
pnpm run migration:down           # Revert last migration batch
pnpm run migration:status         # Show migration history
pnpm run seed                     # Seed roles and development accounts
pnpm run seed:reset               # Wipe database and reseed
```

Run this release's ObjectId reference migration before deploying the code that uses the typed schemas, or deploy them together. Existing passkeys with string user IDs are not found by passkey management until the migration converts them. <!-- feature:mongodb -->

### Seed accounts

The seed script creates two test users in development environments:

| Account            | Role    | Password                                                          |
| ------------------ | ------- | ----------------------------------------------------------------- |
| `admin@seed.local` | `admin` | Random base64 string printed to stdout (or `SEED_ADMIN_PASSWORD`) |
| `user@seed.local`  | `user`  | Random base64 string printed to stdout (or `SEED_USER_PASSWORD`)  |

## Documentation

- [Authentication flow](docs/authentication-flow.md)
- [OAuth authentication](docs/oauth-authentication.md)
- [User roles and permissions](docs/user-roles-permissions.md)
- [Database management](docs/database-management.md)
- [PostgreSQL](docs/database-postgres.md) <!-- feature:postgres -->
- [API routes](docs/api-routes.md)
- [API responses](docs/api-responses.md)
- [Postman collection](docs/postman/README.md)
