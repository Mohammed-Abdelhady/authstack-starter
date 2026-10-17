# AuthStack Starter frontend

The Next.js 16 web app uses React 19 and the App Router. It provides sign-in,
account settings, session controls, and administration for users, roles and
permissions. Locale routing and translations use next-intl.

Arabic catalogues and right-to-left layouts are included when the Arabic locale is selected. <!-- feature:locale-ar -->

## Quick start

Use Node 22.12 through 22.x and pnpm 12.6.0. Run these commands from the
project root after the [backend setup](../backend/README.md#quick-start):

```bash
pnpm install
cp frontend/.env.example frontend/.env.local
pnpm --filter frontend run dev
```

Open `http://localhost:3000`. Set `NEXT_PUBLIC_API_URL` to the backend origin
without `/api`. The host setup uses `http://localhost:5001`. If unset, the
frontend's API fallback is `http://localhost:5000`.

Docker Compose publishes the API on `http://localhost:5000`. <!-- feature:docker -->

The backend and frontend need matching origins and cookie settings.

Follow [production security settings](../docs/operations/production-security.md) before configuring a deployed environment. <!-- feature:production -->

## Tech stack

| Purpose                | Library                         |
| ---------------------- | ------------------------------- |
| Routing and rendering  | Next.js 16 App Router, React 19 |
| API requests and cache | Redux Toolkit and RTK Query     |
| Components             | shadcn/ui and Radix UI          |
| Styling                | Tailwind CSS 4                  |
| Translations           | next-intl                       |
| Product tests          | Vitest and Testing Library      |

## Project structure

```text
src/
├── app/[locale]/           # Localized routes and layouts
├── components/             # Shared UI, forms and navigation
├── modules/                # Authentication and account/admin features
├── store/                  # Redux store and API configuration
├── hooks/                  # Shared hooks
├── lib/                    # Application helpers
├── i18n/                   # Locale configuration and catalogues
└── types/                  # Shared frontend types
```

## Environment variables

Configure the API origin in `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:5001
```

The app reads `GET /api/auth/methods` and `GET /api/auth/oauth/providers`
to discover enabled sign-in methods and configured providers. Backend settings
determine which forms and buttons are available; installing a provider's code
does not register its credentials.

## Key features

| Module                     | What it does                                           |
| -------------------------- | ------------------------------------------------------ |
| `src/modules/auth/`        | Enabled sign-in and credential journeys                |
| `src/modules/oauth/`       | Discovered OAuth/OIDC providers and account linking    | <!-- feature:oauth-core --> |
| `src/modules/account/`     | Profile, password and linked-account settings          |
| `src/modules/roles/`       | Role creation, editing and hierarchy                   |
| `src/modules/users/`       | User administration and role assignment                |
| `src/modules/sessions/`    | Session details, individual revocation and bulk logout |
| `src/modules/permissions/` | Permission checks and selectors                        |

Available sign-in options follow the methods enabled by the backend.
The [authentication setup guides](../docs/README.md#authentication-setup-guides)
explain their required credentials and settings.

## Development

Use the `@/` import alias for `src/`. Reuse the existing UI components and
feature hooks before adding another implementation. Pages and layouts remain
Server Components unless they need hooks, event handlers or browser APIs.
Put `'use client'` on the smallest component that needs those capabilities.

Run the workspace checks from the project root:

```bash
pnpm --filter frontend run lint
pnpm --filter frontend run typecheck
pnpm --filter frontend run test
pnpm --filter frontend run build
```

The direction check runs as part of lint. Keep locale keys consistent across
supported languages and verify interactive changes in both text directions.

## Testing

`pnpm --filter frontend run test` runs product unit tests. Generated projects
also retain the backend functional API suite through
`pnpm --filter backend run test:e2e`.

- [Source repository browser tests](README.maintainer.md)

## Deployment

Run `pnpm --filter frontend run build`, then
`pnpm --filter frontend run start` to serve the production build. Set the public
API origin before building and configure the backend's matching client origin.

<!-- feature:docker:start -->

### Docker

From the project root, copy the Docker example configuration and start Compose:

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up --build
```

<!-- feature:docker:end -->

## Resources

- [Documentation index](../docs/README.md)
- [Backend API](../backend/README.md)
- [Next.js documentation](https://nextjs.org/docs)
- [Tailwind CSS documentation](https://tailwindcss.com/docs)
- [shadcn/ui](https://ui.shadcn.com)
- [RTK Query](https://redux-toolkit.js.org/rtk-query/overview)
