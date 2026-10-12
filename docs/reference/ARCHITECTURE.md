# Architecture

This document describes the request lifecycle, session storage, OAuth provider registry, feature toggles, and security model.

<!-- feature:production:start -->

## System overview

```
                                 Browser Client
                                       │
                         HTTP Requests with Cookies
                                       │
                                       ▼
                             Reverse Proxy (Nginx)
                          TLS Termination, Port 8080/8443
                                       │
                     ┌─────────────────┴─────────────────┐
                     │                                   │
                     ▼                                   ▼
             Frontend Container                  Backend Container
            Next.js 16 (Port 3000)              NestJS 11 (Port 5000)
                     │                                   │
                     │ RTK Query API Requests            │ Mongoose 8 Driver
                     └──────────────────────────────────►│
                                                         ▼
                                                 MongoDB 7 Container
```

The development stack runs the backend, frontend and MongoDB containers with Docker Compose.

<!-- feature:production:end -->

## Request processing pipeline

Every incoming request to the NestJS backend passes through the following layers in order:

1. **Helmet middleware.** Applies standard security headers including Content Security Policy, Frameguard, and DNS Prefetch Control.
2. **Cookie parser.** Parses incoming cookies. It holds no secret. The session cookie carries a random token and the server stores only its hash.
3. **CORS middleware.** Validates request origin against `CLIENT_URL`. Allows credentials (`Access-Control-Allow-Credentials: true`).
4. **Global prefix filter.** Routes all application controllers under `/api`, while keeping `/health` at the server root.
5. **Validation pipe.** Enforces class-validator constraints on request bodies and query parameters. Strips undeclared fields (`whitelist: true`) and transforms payloads to typed DTO instances (`transform: true`).
6. **Authentication guard (`SessionAuthGuard`).** Skips routes decorated with `@Public()`. Reads the session cookie, computes its SHA-256 hash, and verifies the session in MongoDB. Injects the authenticated user document and session into `req.user` and `req.session`.
7. **Authorization guards (`RolesGuard`, `PermissionsGuard`).** Verifies role hierarchy levels and required permission strings against `user.role` and `user.permissions`.
8. **Controller handlers.** Executes domain logic and returns data models.
9. **Response transform interceptor (`TransformInterceptor`).** Wraps standard return values in a uniform envelope: `{ success: true, data: ... }`.
10. **Global exception filter (`AllExceptionsFilter`).** Catches unhandled exceptions, maps them to standard HTTP status codes, and formats errors as `{ success: false, error: { code, message, details } }`.

## Permission grant transactions

Role and permission grants reread the actor and relevant roles inside their write transaction. Authority changes cannot commit between this check and the grant.

<!-- feature:postgres:start -->

PostgreSQL holds shared row locks with `NOWAIT`.
<!-- feature:postgres:end -->

<!-- feature:mongodb:start -->

MongoDB writes hidden authority fences without changing business timestamps.
On MongoDB, grant operations from one actor are serialized before opening a transaction. Each process admits at most 32 active or waiting operations per actor and 256 in total. Overflow returns the existing database-unavailable response with HTTP 503. Success and failure release admission. Other processes and actors sharing a role may still encounter transaction contention, which uses the existing bounded retry policy and can return 503.
<!-- feature:mongodb:end -->

## Cookie session model

The application uses stateful, cookie-backed sessions instead of stateless JWTs.

### Cookie names and security flags

- **Development:** Cookie name is `sid`.
- **Production:** Cookie name is `__Host-sid`.

The `__Host-` prefix enforces three browser security rules:

- The cookie must have the `Secure` flag set.
- The cookie must originate from an HTTPS endpoint.
- The cookie must have `Path=/` and must not specify a `Domain` attribute.

All session cookies use `HttpOnly: true` and `SameSite: 'lax'`. JavaScript running in the browser cannot access the session token.

### Token hashing and verification

1. During login, the server generates a cryptographically random 32-byte string using `crypto.randomBytes(32)`.
2. The server calculates the SHA-256 digest of the token string.
3. The server writes a new session document to MongoDB storing `tokenHash: sha256(token)`, the user reference, client IP, parsed user-agent, and expiration time.
4. The server writes the raw token string into the response cookie.
5. On subsequent requests, the server reads the cookie, computes the SHA-256 digest, and looks up the document in MongoDB by `tokenHash`.

If a database dump is leaked, attackers cannot use the stored `tokenHash` values to hijack active browser sessions.

### Session lifecycle

- Default duration is 7 days. If the user selects rememberMe, the duration is 30 days.
- Each request updates `lastActiveAt` to track activity.
- Users can view and revoke active devices from their account settings.
- MongoDB removes expired session records automatically using a TTL index on `expiresAt`.

## Two-factor authentication flow

When an account has two-factor authentication enabled, authentication splits into two phases.

```
1. Initial login (Password / Magic Link / Passkey / OAuth)
   │
   ├─► Server validates primary credential
   ├─► Server detects 2FA is enabled on the account
   ├─► Server generates random challenge nonce and stores hash in twofactorchallenges collection
   ├─► Server sets signed HttpOnly cookie: 2fa_challenge=<nonce>
   └─► Server responds: { success: true, data: { requires2FA: true } }

2. Second factor verification (POST /api/auth/2fa/verify)
   │
   ├─► Client submits code (or passkey assertion) with 2fa_challenge cookie
   ├─► Server finds challenge by SHA-256(nonce)
   ├─► Server validates TOTP code, recovery code, or WebAuthn assertion
   ├─► Server deletes challenge document and clears 2fa_challenge cookie
   ├─► Server issues session document and sets session cookie (__Host-sid)
   └─► Server responds: { success: true, data: { user: ... } }
```

The `2fa_challenge` cookie expires after 5 minutes and is valid only for the user ID tied to that challenge.

## Passkey authentication (WebAuthn)

Passkeys use `@simplewebauthn/server` and `@simplewebauthn/browser` implementing the WebAuthn standard.

1. **Registration:**
   - Client calls `POST /api/auth/passkeys/register/options` with an active session.
   - Server returns registration options including challenge bytes, relying party ID, and user identity.
   - Browser prompts for biometric verification (Touch ID, Face ID, Windows Hello, or hardware key).
   - Client calls `POST /api/auth/passkeys/register/verify` with the authenticator response.
   - Server validates the attestation response, checks the signature, and stores the credential ID and public key buffer in the `passkeys` collection.

2. **Authentication:**
   - Client calls `POST /api/auth/passkeys/login/options`.
   - Browser invokes `navigator.credentials.get()`.
   - Client calls `POST /api/auth/passkeys/login/verify` with the assertion response.
   - Server looks up the public key by `credentialId`, verifies the signature, and checks the signature counter to prevent replay attacks.
   - Server issues a session cookie.

## OAuth provider registry

OAuth providers run through a unified provider registry in `OAuthService`.

### Provider interface

Each provider implements the `OAuthProvider` contract:

- `name`: Lowercase provider slug (`google`, `github`, etc.).
- `getAuthorizationUrl(state, codeVerifier?)`: Returns the redirection URL for sign-in.
- `exchangeCode(code, codeVerifier?)`: Exchanges the authorization code for an access token.
- `getUserProfile(tokens)`: Retrieves the user's standardized profile (`id`, `email`, `name`, `avatarUrl`).

### OAuth request lifecycle

1. **Start:** Client initiates login with `GET /api/auth/oauth/:provider/start?redirect=/dashboard`.
   - Server generates a random state token and optional PKCE code verifier.
   - Server stores state data in a signed `oauth_state` HTTP-only cookie.
   - Server redirects the browser to the provider authorization URL.
2. **Provider interaction:** The user logs in at the third-party provider and approves permissions.
3. **Callback:** Provider redirects the browser back to `GET /api/auth/oauth/:provider/callback` (or `POST` for Apple form post).
   - Server reads the `oauth_state` cookie, verifies the cryptographic signature, and checks that the state parameter matches.
   - Server exchanges the authorization code for tokens.
   - Server fetches the standardized user profile.
   - If a matching account exists by provider ID or verified email, the server links the identity in `user.linkedAccounts`. If no account exists, the server creates one.
   - Server issues a session cookie and redirects the browser back to the frontend destination.

## Dynamic authentication discovery

The backend exposes its enabled authentication capabilities through `GET /api/auth/methods`.

The response returns:

```json
{
  "success": true,
  "data": {
    "methods": {
      "password": true,
      "magicLink": true,
      "passkeys": true,
      "twoFactor": true,
      "oauth": [
        { "id": "google", "displayName": "Google" },
        { "id": "github", "displayName": "GitHub" },
        { "id": "facebook", "displayName": "Facebook" }
      ]
    }
  }
}
```

The frontend uses this endpoint to configure available login options dynamically. If an OAuth provider or authentication method is disabled in backend environment variables, the frontend omits its UI buttons and routes.

## Error handling and responses

### Success format

All successful responses return HTTP status 200 or 201 with the following structure:

```json
{
  "success": true,
  "data": { ... }
}
```

### Error format

All errors return appropriate HTTP 4xx or 5xx status codes with the following structure:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or password",
    "details": null
  }
}
```

The error `code` string provides a stable key for frontend internationalization lookup in `next-intl`.
