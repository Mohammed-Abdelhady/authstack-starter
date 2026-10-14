# Documentation

Index of architecture documents, system guides, and provider setup tutorials.

## Core guides

- [Session device names](../backend/docs/session-device-names.md): Session response parts, localized names, and legacy fallback.
- [Architecture](reference/ARCHITECTURE.md): Request pipeline, session storage, OAuth provider registry, and security model.
- [Database schema](reference/DATABASE_SCHEMA.md): MongoDB collections, document models, indexes, and migrations.
- [Two-factor challenges and seed data](reference/database-schema-two-factor-challenges.md)
- [RBAC system](access-control/RBAC-SYSTEM.md): Dynamic role levels, permissions, and guard enforcement.
- [RBAC API and frontend integration](access-control/RBAC-SYSTEM-api-reference.md)
- [RBAC examples, security, and testing](access-control/RBAC-SYSTEM-security-and-testing.md)
- [RBAC implementation summary](access-control/RBAC-IMPLEMENTATION-SUMMARY.md)
- [RBAC migration and implementation notes](access-control/RBAC-IMPLEMENTATION-SUMMARY-migration.md)
- [Migration guide](operations/MIGRATION-GUIDE.md): Database migrations and rollback procedures.
- [Manual migration, deployment, and rollback](operations/MIGRATION-GUIDE-manual-migration.md)
- [Migration verification and troubleshooting](operations/MIGRATION-GUIDE-verification.md)
- [Production setup](operations/PRODUCTION-SETUP.md): Production checklist, SSL certificates, and Nginx proxy.
- [Code quality](reference/code-quality.md): Local lint, format, hard-ban hooks, and tests on push.
- [Deployment](operations/deployment.md): Docker Compose and cloud deployment instructions.
- [Custom domains and deployment troubleshooting](operations/deployment-custom-domain.md)
- [Production security settings](operations/production-security.md): Start checks, cookie rules, rate limit counters, and the security headers each layer sends.

## Authentication setup guides

### Credentials and second factor

- [SMTP setup](setup/setup-smtp.md): Email verification and password resets.
- [SMTP mail service and troubleshooting](setup/setup-smtp-mail-service.md)
- [SMTP production recommendations](setup/setup-smtp-production.md)
- [Mail languages and link addresses](setup/setup-mail-links.md): The language each mail is written in, and where its links point.
- [Magic link setup](setup/setup-magic-link.md): Passwordless email sign-in links.
- [Two-factor setup](setup/setup-two-factor.md): Time-based one-time password (TOTP) and recovery codes.
- [Passkey setup](setup/setup-passkeys.md): WebAuthn passkey registration and sign-in.

### OAuth and OIDC providers

- [Google setup](setup/setup-google-oauth.md): Google Cloud OAuth 2.0 credentials and consent screen.
- [Advanced Google OAuth configuration](setup/setup-google-oauth-advanced-configuration.md)
- [GitHub setup](setup/setup-github-oauth.md): GitHub OAuth application registration and private email handling.
- [GitHub OAuth troubleshooting and security](setup/setup-github-oauth-troubleshooting.md)
- [GitHub OAuth app options and monitoring](setup/setup-github-oauth-app-options.md)
- [Facebook setup](setup/setup-facebook-oauth.md): Meta developer portal configuration.
- [Facebook OAuth publishing and advanced configuration](setup/setup-facebook-oauth-publishing-and-configuration.md)
- [Facebook permissions](setup/facebook-oauth-permissions.md): Permission scope reference for Facebook.
- [Apple setup](setup/setup-apple-oauth.md): Sign in with Apple and form post callback.
- [Discord setup](setup/setup-discord-oauth.md): Discord developer portal and OAuth application.
- [GitLab setup](setup/setup-gitlab-oauth.md): GitLab OAuth application for SaaS or self-hosted instances.
- [LinkedIn setup](setup/setup-linkedin-oauth.md): LinkedIn OpenID Connect application.
- [Microsoft setup](setup/setup-microsoft-oauth.md): Microsoft Entra ID (Azure AD) registration.
- [Generic OIDC setup](setup/setup-oidc-oauth.md): Any OpenID Connect identity provider via discovery document.
- [Slack setup](setup/setup-slack-oauth.md): Slack OAuth 2.0 app configuration.
- [Twitch setup](setup/setup-twitch-oauth.md): Twitch developer console and claims.
- [X (Twitter) setup](setup/setup-x-oauth.md): X OAuth 2.0 app with PKCE.

## Backend documentation

See [backend/docs/](../backend/docs/):

- [Authentication flow](../backend/docs/authentication-flow.md): Step-by-step authentication flows and session creation.
- [OAuth authentication](../backend/docs/oauth-authentication.md): OAuth provider registry and provider addition steps.
- [User roles and permissions](../backend/docs/user-roles-permissions.md): RBAC model, role levels, and permission checks.
- [Database management](../backend/docs/database-management.md): MongoDB connection, migrations, and seed commands.
- [PostgreSQL](../backend/docs/database-postgres.md): Version, settings, migrations, retention, and how the tests run. <!-- feature:postgres -->
- [API routes](../backend/docs/api-routes.md): Every route, who may call it and the setting that closes it.
- [API responses](../backend/docs/api-responses.md): Response envelope formats and error codes.
- [Postman collection](../backend/docs/postman/README.md): Postman collection, environments, and test scripts.

## Workspaces

- [Project README](../README.md): Repository root and quick start.
- [Backend README](../backend/README.md): NestJS API server configuration and routes.
- [Frontend README](../frontend/README.md): Next.js application setup and state management.
