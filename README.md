# Full-stack authentication boilerplate

Production boilerplate with a NestJS 11 backend and a Next.js 16 frontend. Uses cookie-based sessions, dynamic role-based access control, and multiple authentication options.

## Features

- Email and password registration with a 6-digit verification code sent by email
- Magic link sign-in sent by email <!-- feature:magic-link -->
- Two-factor authentication (TOTP) with single-use recovery codes <!-- feature:totp -->
- Passkey (WebAuthn) registration and authentication <!-- feature:passkeys -->
- 12 OAuth providers plus generic OIDC
- Dynamic role-based access control with role hierarchy, custom permissions, and direct user overrides
- Multi-session management with device, browser, OS, and IP tracking
- Account linking across multiple OAuth providers
- Dynamic runtime auth method discovery via `GET /api/auth/methods`

## Tech stack

| Layer    | Technology                                        |
| -------- | ------------------------------------------------- |
| Backend  | NestJS 11, TypeScript, MongoDB, Mongoose 8        | <!-- feature:mongodb -->  |
| Backend  | NestJS 11, TypeScript, PostgreSQL 18, Kysely      | <!-- feature:postgres --> |
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS 4 |
| State    | Redux Toolkit (RTK Query)                         |
| UI       | shadcn/ui, Radix UI, Lucide Icons                 |
| i18n     | next-intl                                         |
| Tests    | Jest, Playwright                                  |

## Scaffold a new project

To scaffold a project with only the authentication methods you want:

```bash
pnpm dlx create-nest-next-auth my-app
```

The CLI prompts for the sign-in methods to keep. It removes unused strategy files, controller endpoints, frontend UI modules, environment variables, and setup docs. See [CLI options and flags](https://github.com/Mohammed-Abdelhady/nextjs-nestjs-oauth-rbac-boilerplate/blob/master/packages/create-nest-next-auth/README.md).

## Choose your auth methods

At runtime, the frontend calls `GET /api/auth/methods` to learn which authentication flows the backend enables. The backend checks its configuration and returns the active providers, credential toggles, magic link availability, passkey support, and two-factor requirements. The frontend renders only the matching forms and buttons.

| Method              | Type                  | Setup guide                                            |
| ------------------- | --------------------- | ------------------------------------------------------ |
| Email and password  | Credential            | [SMTP setup](docs/setup/setup-smtp.md)                 | <!-- feature:email-password --> |
| Magic link          | Passwordless          | [Magic link setup](docs/setup/setup-magic-link.md)     | <!-- feature:magic-link -->     |
| Two-factor (TOTP)   | Second factor         | [Two-factor setup](docs/setup/setup-two-factor.md)     | <!-- feature:totp -->           |
| Passkeys (WebAuthn) | Credential / 2FA      | [Passkey setup](docs/setup/setup-passkeys.md)          | <!-- feature:passkeys -->       |
| Google              | OAuth 2.0             | [Google setup](docs/setup/setup-google-oauth.md)       | <!-- feature:google -->         |
| GitHub              | OAuth 2.0             | [GitHub setup](docs/setup/setup-github-oauth.md)       | <!-- feature:github -->         |
| Facebook            | OAuth 2.0             | [Facebook setup](docs/setup/setup-facebook-oauth.md)   | <!-- feature:facebook -->       |
| Apple               | OAuth 2.0 / Form post | [Apple setup](docs/setup/setup-apple-oauth.md)         | <!-- feature:apple -->          |
| Discord             | OAuth 2.0             | [Discord setup](docs/setup/setup-discord-oauth.md)     | <!-- feature:discord -->        |
| GitLab              | OIDC                  | [GitLab setup](docs/setup/setup-gitlab-oauth.md)       | <!-- feature:gitlab -->         |
| LinkedIn            | OIDC                  | [LinkedIn setup](docs/setup/setup-linkedin-oauth.md)   | <!-- feature:linkedin -->       |
| Microsoft           | OAuth 2.0             | [Microsoft setup](docs/setup/setup-microsoft-oauth.md) | <!-- feature:microsoft -->      |
| Generic OIDC        | OIDC                  | [OIDC setup](docs/setup/setup-oidc-oauth.md)           | <!-- feature:oidc -->           |
| Slack               | OIDC                  | [Slack setup](docs/setup/setup-slack-oauth.md)         | <!-- feature:slack -->          |
| Twitch              | OIDC                  | [Twitch setup](docs/setup/setup-twitch-oauth.md)       | <!-- feature:twitch -->         |
| X (Twitter)         | OAuth 2.0 with PKCE   | [X setup](docs/setup/setup-x-oauth.md)                 | <!-- feature:x -->              |

## Quick start

Use Node 22 (22.12 or newer) and pnpm 12.6.0. Node 22 includes Corepack. Enable the pinned manager before cloning or scaffolding:

```bash
nvm use 22
corepack enable
corepack prepare pnpm@12.6.0 --activate
pnpm --version
```

<!-- repository-only:start -->

Clone the repository:

```bash
git clone https://github.com/Mohammed-Abdelhady/nextjs-nestjs-oauth-rbac-boilerplate.git
cd nextjs-nestjs-oauth-rbac-boilerplate
```

<!-- repository-only:end -->

Install dependencies from the project folder:

```bash
pnpm install
```

<!-- feature:docker:start -->

### Start with Docker

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up --build
```

<!-- feature:docker:end -->

Copy the example configuration files:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

<!-- feature:postgres:start -->

### Prepare PostgreSQL

The backend needs PostgreSQL 18 or newer, because new ids come from the `uuidv7()` function of the server. Create a database, put its address in `POSTGRES_URL` in `backend/.env`, and apply the migrations once. The server checks them when it starts and never applies one itself.

Set `DATABASE_TYPE=postgres` in `backend/.env` as well. Without it the server runs on MongoDB. <!-- feature:database-choice -->

```bash
pnpm --filter backend run migration:postgres:up
```

<!-- feature:postgres:end -->

### Start manually

<!-- feature:mongodb:start -->

The backend needs MongoDB running as a replica set, because sign-in uses transactions. `MONGO_URI` in `backend/.env` expects one named `rs0` on port 27017:

```bash
mkdir -p ./mongodb-data
mongod --replSet rs0 --dbpath ./mongodb-data

# Leave mongod running. In another terminal, once:
mongosh --eval "rs.initiate()"
```

<!-- feature:mongodb:end -->

```bash
# In one terminal, start the backend:
pnpm --filter backend run start:dev

# In another terminal, start the frontend:
pnpm --filter frontend run dev
```

Endpoints:

- Frontend: http://localhost:3000
- Backend API: http://localhost:5001/api
- Health check: http://localhost:5001/health
- Swagger documentation: http://localhost:5001/api/docs (set `SWAGGER_ENABLED=true` in `backend/.env`)

## Environment configuration

### Key backend variables (`backend/.env`)

| Variable                        | Description                                                            | Default                                               |
| ------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| `PORT`                          | API server port. Example file sets `5001`.                             | `3000` when unset                                     |
| `NODE_ENV`                      | Environment name                                                       | `development`                                         |
| `MONGO_URI`                     | MongoDB URI                                                            | `mongodb://localhost:27017/authboiler?replicaSet=rs0` | <!-- feature:mongodb -->             |
| `CLIENT_URL`                    | Frontend origin for CORS and cookie domain                             | `http://localhost:3000`                               |
| `OAUTH_STATE_SECRET`            | Secret used to sign OAuth state cookies                                | Required in production                                | <!-- feature:oauth-core,passkeys --> |
| `AUTH_NATIVE_DPOP_NONCE_SECRET` | HMAC secret for DPoP nonces; required when `AUTH_NATIVE_ENABLED=true`  | At least 32 characters when native sign-in is enabled | <!-- feature:native-core -->         |
| `API_URL`                       | Public API origin used for OAuth callbacks and native sign-in          | None. Use an https origin in production               | <!-- feature:native-core -->         |
| `AUTH_NATIVE_DPOP_REQUIRED`     | Reject native exchanges without DPoP and refreshes of unbound families | `false`                                               | <!-- feature:native-core -->         |
| `TOTP_ENCRYPTION_KEY`           | 32-byte hex key to encrypt TOTP secrets                                | Required for 2FA                                      | <!-- feature:totp -->                |

<!-- feature:postgres:start -->

### PostgreSQL variables (`backend/.env`)

| Variable            | Description                                              | Default        |
| ------------------- | -------------------------------------------------------- | -------------- |
| `DATABASE_TYPE`     | The database the server runs on: `mongodb` or `postgres` | `mongodb`      | <!-- feature:database-choice --> |
| `POSTGRES_URL`      | PostgreSQL address, version 18 or newer                  | None, required |
| `POSTGRES_POOL_MAX` | Connections the server may hold open, from 1 to 200      | `10`           |

<!-- feature:postgres:end -->

### Optional authentication settings

| Variables                                                                                                                                                                                                                                                                              | Purpose                                                  | Example files                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------- |
| `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`, `OAUTH_GOOGLE_CALLBACK_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`                                                                                                                                                                    | Google configuration. See its setup guide.               | `backend/.env.example` and `frontend/.env.example` | <!-- feature:google -->                    |
| `OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GITHUB_CLIENT_SECRET`, `OAUTH_GITHUB_CALLBACK_URL`, `NEXT_PUBLIC_GITHUB_CLIENT_ID`                                                                                                                                                                    | GitHub configuration. See its setup guide.               | `backend/.env.example` and `frontend/.env.example` | <!-- feature:github -->                    |
| `OAUTH_FACEBOOK_CLIENT_ID`, `OAUTH_FACEBOOK_CLIENT_SECRET`, `OAUTH_FACEBOOK_CALLBACK_URL`, `NEXT_PUBLIC_FACEBOOK_APP_ID`                                                                                                                                                               | Facebook configuration. See its setup guide.             | `backend/.env.example` and `frontend/.env.example` | <!-- feature:facebook -->                  |
| `MAGIC_LINK_ENABLED`, `MAGIC_LINK_EXPIRES_IN`, `MAGIC_LINK_MAX_PER_HOUR`                                                                                                                                                                                                               | Magic link configuration. See its setup guide.           | `backend/.env.example` and `frontend/.env.example` | <!-- feature:magic-link -->                |
| `TWO_FACTOR_ENABLED`                                                                                                                                                                                                                                                                   | TOTP two-factor configuration. See its setup guide.      | `backend/.env.example` and `frontend/.env.example` | <!-- feature:totp -->                      |
| `PASSKEYS_ENABLED`, `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGIN`                                                                                                                                                                                                            | Passkeys configuration. See its setup guide.             | `backend/.env.example` and `frontend/.env.example` | <!-- feature:passkeys -->                  |
| `OAUTH_MICROSOFT_CLIENT_ID`, `OAUTH_MICROSOFT_CLIENT_SECRET`, `OAUTH_MICROSOFT_CALLBACK_URL`, `OAUTH_MICROSOFT_TENANT`                                                                                                                                                                 | Microsoft configuration. See its setup guide.            | `backend/.env.example` and `frontend/.env.example` | <!-- feature:microsoft -->                 |
| `OAUTH_APPLE_CLIENT_ID`, `OAUTH_APPLE_CALLBACK_URL`, `OAUTH_APPLE_TEAM_ID`, `OAUTH_APPLE_KEY_ID`, `OAUTH_APPLE_PRIVATE_KEY`                                                                                                                                                            | Apple configuration. See its setup guide.                | `backend/.env.example` and `frontend/.env.example` | <!-- feature:apple -->                     |
| `OAUTH_DISCORD_CLIENT_ID`, `OAUTH_DISCORD_CLIENT_SECRET`, `OAUTH_DISCORD_CALLBACK_URL`                                                                                                                                                                                                 | Discord configuration. See its setup guide.              | `backend/.env.example` and `frontend/.env.example` | <!-- feature:discord -->                   |
| `OAUTH_LINKEDIN_CLIENT_ID`, `OAUTH_LINKEDIN_CLIENT_SECRET`, `OAUTH_LINKEDIN_CALLBACK_URL`                                                                                                                                                                                              | LinkedIn configuration. See its setup guide.             | `backend/.env.example` and `frontend/.env.example` | <!-- feature:linkedin -->                  |
| `OAUTH_GITLAB_CLIENT_ID`, `OAUTH_GITLAB_CLIENT_SECRET`, `OAUTH_GITLAB_CALLBACK_URL`, `OAUTH_GITLAB_BASE_URL`                                                                                                                                                                           | GitLab configuration. See its setup guide.               | `backend/.env.example` and `frontend/.env.example` | <!-- feature:gitlab -->                    |
| `OAUTH_X_CLIENT_ID`, `OAUTH_X_CLIENT_SECRET`, `OAUTH_X_CALLBACK_URL`                                                                                                                                                                                                                   | X configuration. See its setup guide.                    | `backend/.env.example` and `frontend/.env.example` | <!-- feature:x -->                         |
| `OAUTH_SLACK_CLIENT_ID`, `OAUTH_SLACK_CLIENT_SECRET`, `OAUTH_SLACK_CALLBACK_URL`                                                                                                                                                                                                       | Slack configuration. See its setup guide.                | `backend/.env.example` and `frontend/.env.example` | <!-- feature:slack -->                     |
| `OAUTH_TWITCH_CLIENT_ID`, `OAUTH_TWITCH_CLIENT_SECRET`, `OAUTH_TWITCH_CALLBACK_URL`                                                                                                                                                                                                    | Twitch configuration. See its setup guide.               | `backend/.env.example` and `frontend/.env.example` | <!-- feature:twitch -->                    |
| `OAUTH_OIDC_CLIENT_ID`, `OAUTH_OIDC_CLIENT_SECRET`, `OAUTH_OIDC_CALLBACK_URL`, `OAUTH_OIDC_ISSUER`, `OAUTH_OIDC_PROVIDER_ID`, `OAUTH_OIDC_DISPLAY_NAME`, `OAUTH_OIDC_SCOPES`, `OAUTH_OIDC_AUTHORIZATION_URL`, `OAUTH_OIDC_TOKEN_URL`, `OAUTH_OIDC_USERINFO_URL`, `OAUTH_OIDC_JWKS_URL` | Generic OIDC configuration. See its setup guide.         | `backend/.env.example` and `frontend/.env.example` | <!-- feature:oidc -->                      |
| `SMTP_HOST`                                                                                                                                                                                                                                                                            | Mail delivery shared by password and magic link sign-in. | `backend/.env.example`                             | <!-- feature:email-password,magic-link --> |
| `SMTP_PORT`                                                                                                                                                                                                                                                                            | Mail delivery shared by password and magic link sign-in. | `backend/.env.example`                             | <!-- feature:email-password,magic-link --> |
| `SMTP_SECURE`                                                                                                                                                                                                                                                                          | Mail delivery shared by password and magic link sign-in. | `backend/.env.example`                             | <!-- feature:email-password,magic-link --> |
| `SMTP_USER`                                                                                                                                                                                                                                                                            | Mail delivery shared by password and magic link sign-in. | `backend/.env.example`                             | <!-- feature:email-password,magic-link --> |
| `SMTP_PASS`                                                                                                                                                                                                                                                                            | Mail delivery shared by password and magic link sign-in. | `backend/.env.example`                             | <!-- feature:email-password,magic-link --> |
| `EMAIL_FROM`                                                                                                                                                                                                                                                                           | Mail delivery shared by password and magic link sign-in. | `backend/.env.example`                             | <!-- feature:email-password,magic-link --> |

### Key frontend variables (`frontend/.env.local`)

| Variable              | Description                          | Default                 |
| --------------------- | ------------------------------------ | ----------------------- |
| `NEXT_PUBLIC_API_URL` | Backend origin without `/api` suffix | `http://localhost:5001` |

See [docs/README.md](docs/README.md) for provider-specific credentials and mail settings.

<!-- feature:mongodb:start -->

For a host-run backend with MongoDB in Docker Compose, use `MONGO_URI=mongodb://USER:PASS@localhost:27017/authboiler?authSource=admin&directConnection=true`. The replica set advertises `mongodb:27017`, which only containers on the Compose network can resolve. <!-- feature:docker -->

<!-- feature:mongodb:end -->
<!-- feature:postgres:start -->

For a host-run backend with PostgreSQL in Docker Compose, use `POSTGRES_URL=postgres://USER:PASS@localhost:5432/authboiler`. Compose publishes the database on port 5432. <!-- feature:docker -->

<!-- feature:postgres:end -->

<!-- feature:native-expo:start -->

## Mobile app

The Expo app lives in `mobile/expo`. It signs in on the web sign-in page in the system browser, then shows the profile and the sessions.

It has been built and run on an iOS simulator against this server. Android has not been built or run, so treat it as unverified.

### What the server needs

Set these in `backend/.env` before you start the backend:

- `AUTH_NATIVE_ENABLED=true`
- `AUTH_NATIVE_DPOP_NONCE_SECRET` with a random value of at least 32 characters. `openssl rand -hex 32` makes one.
- `API_URL` with the address the app uses to reach the API. On a simulator that is `http://localhost:5001`.
- `AUTH_NATIVE_APPLICATIONS` as `backend/.env.example` writes it. Its client id and return address come from the `scheme` in `mobile/expo/app.json`. If you change the scheme, change this line to match.

If you start the server with Docker, set the same four in `.env.docker` instead. Docker serves the API on port 5000, so `API_URL` is `http://localhost:5000` there. <!-- feature:docker -->

The backend does not start with `AUTH_NATIVE_ENABLED=true` until the secret and `API_URL` are set.

The web app must be running too, because sign-in happens on its pages. You also need an account to sign in with. [Seed data](#seed-data) makes two.

### Run it on an iOS simulator

You need a Mac with Xcode and CocoaPods. Expo creates the native iOS project the first time you run the app.

From a fresh folder, in this order:

```bash
pnpm install
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

# Edit backend/.env as described above. Start MongoDB, then in one terminal:
pnpm --filter backend run start:dev

# In a second terminal:
pnpm --filter frontend run dev

# In a third terminal, once, to make the two seed accounts:
pnpm --filter backend run seed

# Then build the app and open it on a simulator:
pnpm --filter @app/mobile-expo run ios
```

The last command builds the app, installs it and keeps running to serve the JavaScript. Leave it open while you use the app. If the simulator asks whether to open the page in your app, choose Open.

After the first build, `pnpm --filter @app/mobile-expo run start` serves the JavaScript without building again. Open the app from the simulator's home screen.

A development build talks to `http://localhost:5001`. Set `EXPO_PUBLIC_API_ORIGIN` to use another address. A release build does not start without it.

With Docker the API is on port 5000, so run the app like this: <!-- feature:docker -->

<!-- feature:docker:start -->

```bash
EXPO_PUBLIC_API_ORIGIN=http://localhost:5000 pnpm --filter @app/mobile-expo run ios
```

<!-- feature:docker:end -->

The app name, slug, application id and scheme live in `mobile/expo/app.json` and nowhere else. Signing a build for a device or a store is yours to set up.

<!-- feature:native-expo:end -->

## Seed data

Run the database seed script from the backend directory:

```bash
cd backend
pnpm run seed
```

The script runs only when `NODE_ENV` is `development` or `test`. It creates four system roles (`user`, `support`, `manager`, `admin`) and two seed accounts:

| Email              | Default role | Password                                         |
| ------------------ | ------------ | ------------------------------------------------ |
| `admin@seed.local` | `admin`      | Generated random base64 string printed to stdout |
| `user@seed.local`  | `user`       | Generated random base64 string printed to stdout |

To set explicit passwords for seed accounts, set `SEED_ADMIN_PASSWORD` and `SEED_USER_PASSWORD` in `backend/.env` before running the command.

To wipe and reseed the database:

```bash
pnpm --filter backend run seed:reset
```

## Documentation

| Guide                                                   | Description                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Architecture](docs/reference/ARCHITECTURE.md)          | Request lifecycle, session storage, OAuth registry, and security model |
| [Database schema](docs/reference/DATABASE_SCHEMA.md)    | MongoDB collections, indexes, and migrations                           |
| [PostgreSQL](backend/docs/database-postgres.md)         | Version, settings, migrations, retention, and how the tests run        | <!-- feature:postgres -->   |
| [RBAC system](docs/access-control/RBAC-SYSTEM.md)       | Role levels, permission inheritance, and enforcement guards            |
| [Migration guide](docs/operations/MIGRATION-GUIDE.md)   | Database migration scripts and versioning                              |
| [Production setup](docs/operations/PRODUCTION-SETUP.md) | Domain configuration, SSL termination, and Nginx reverse proxy         | <!-- feature:production --> |
| [Code quality](docs/reference/code-quality.md)          | Linting, formatting, git hooks, and E2E tests                          |
| [Deployment](docs/operations/deployment.md)             | Docker Compose and cloud deployment guides                             | <!-- feature:production --> |
| [Backend guide](backend/README.md)                      | Backend modules, controllers, and configuration schema                 |
| [Frontend guide](frontend/README.md)                    | Frontend routing, components, and internationalization                 |

## Contributing

1. Create a feature branch: `git checkout -b feat/feature-name`
2. Follow [Conventional Commits](https://conventionalcommits.org) format for commit messages.
3. Verify that tests and lint checks pass: `pnpm run lint && pnpm run test`
4. Submit a pull request.

## License

MIT
