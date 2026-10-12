# OAuth authentication

This document describes the OAuth 2.0 and OpenID Connect (OIDC) architecture, endpoints, and instructions for adding new identity providers.

## Architecture

The application uses a registry-based provider pattern to support multiple authentication providers.

```
Browser Client              OAuthController             OAuthRegistry           External Provider
     │                             │                          │                        │
     ├─► GET /:provider/start ────►│                          │                        │
     │                             ├─► Get provider ─────────►│                        │
     │                             │   strategy               │                        │
     │                             ├─► Generate state & PKCE  │                        │
     │                             ├─► Set oauth_state cookie │                        │
     │◄── 302 Redirect to URL ─────┴──────────────────────────┼───────────────────────►│
     │                                                                                 │
     │   User authenticates and grants consent                                         │
     │                                                                                 │
     ├─► GET /:provider/callback?code=... ────────────────────────────────────────────►│
     │   (with oauth_state cookie) │                                                   │
     │                             ├─► Verify state & PKCE                             │
     │                             ├─► Exchange code for token ───────────────────────►│
     │                             │◄─ Return tokens ──────────────────────────────────┤
     │                             ├─► Fetch user profile ────────────────────────────►│
     │                             │◄─ Return profile (id, email, name, avatar) ───────┤
     │                             ├─► Link or create user in MongoDB                  │
     │                             ├─► Issue session cookie (__Host-sid)               │
     │◄── 302 Redirect to client ──┴───────────────────────────────────────────────────┘
```

### Components

1. **OAuth provider interface** ([`oauth-provider.interface.ts`](../src/auth/oauth/oauth-provider.interface.ts))
   Defines the contract for all providers: `name`, `displayName`, `isEnabled()`, `getAuthorizationUrl()`, `exchangeCode()`, and `getUserProfile()`.
2. **Base OAuth strategy** ([`base-oauth.strategy.ts`](../src/auth/oauth/base-oauth.strategy.ts))
   Provides common HTTP requests, error mapping, and authorization URL construction for standard OAuth 2.0 endpoints.
3. **OAuth state service** ([`oauth-state.service.ts`](../src/auth/oauth/oauth-state.service.ts))
   Generates cryptographically random state tokens, PKCE code verifiers and challenges, and signs state cookies using `OAUTH_STATE_SECRET`.
4. **OAuth registry service** ([`oauth-registry.service.ts`](../src/auth/oauth/oauth-registry.service.ts))
   Registers provider strategy instances and filters enabled providers based on configured environment variables.
5. **OAuth service** ([`oauth.service.ts`](../src/auth/oauth/oauth.service.ts))
   Matches incoming provider profiles to user accounts, manages `user.linkedAccounts`, updates profiles, and creates session documents.
6. **OAuth controller** ([`oauth.controller.ts`](../src/auth/oauth/oauth.controller.ts))
   Handles HTTP start routes, callbacks, and provider listing.

## Endpoints

### 1. List enabled providers

**Endpoint:** `GET /api/auth/oauth/providers`

Returns the list of OAuth providers that have credentials configured in backend environment variables.

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "providers": [
      {
        "id": "google",
        "displayName": "Google"
      },
      {
        "id": "github",
        "displayName": "GitHub"
      }
    ]
  }
}
```

### 2. Start provider authentication

**Endpoint:** `GET /api/auth/oauth/:provider/start?redirect={path}`

Initiates the OAuth handshake. Generates a random state token and PKCE code verifier (if supported by the provider), sets a signed HTTP-only state cookie, and issues an HTTP 302 redirect to the provider's authorization URL. The cookie is named `oauth_<provider>` in development and `__Host-oauth_<provider>` in production, where it is `Secure` and on path `/`.

**Query parameters:**

- `redirect` (optional): Frontend path to redirect to after successful login (for example `/dashboard`). Paths must be relative to prevent open-redirect vulnerabilities.
- `intent` (optional): `link` attaches the provider to the signed-in account and needs the session cookie on this request. The account and the session are written into the signed state here, because the callback is a navigation the provider's site starts and a browser sends no `SameSite=Strict` cookie with it. The callback completes the link from the state when that session is still live, and answers `SESSION_INVALID` when it was ended since.

### 3. Handle provider callback

**Endpoint:** `GET /api/auth/oauth/:provider/callback`

Receives the authorization code and state parameter from the third-party provider.

1. Verifies the `state` query parameter against the signed `oauth_state` cookie.
2. Exchanges the authorization code for an access token.
3. Retrieves the normalized user profile from the provider.
4. Finds an existing account by provider account ID or verified email address.
5. If an account is found, records the provider identity in `linkedAccounts`. If no account exists, creates a new user.
   An account found by its address alone is attached to only when the provider states, for each address, that it verified it, and when the account's own address was verified by this server. Facebook sends no such statement, so a first Facebook sign-in cannot create an account or join one by address. The person signs in another way and links Facebook in the settings. An already linked Facebook identity can still sign in.
6. Clears the `oauth_state` cookie, issues a session cookie (`sid` in development, `__Host-sid` in production), and redirects the browser to the destination path.

**Endpoint:** `POST /api/auth/oauth/:provider/callback`

Handles Apple OAuth callbacks that use the `form_post` response mode.

### 4. Legacy callback endpoint

**Endpoint:** `POST /api/auth/oauth/callback`

This legacy endpoint is retired. Requests to this route return HTTP 410 Gone.

### 5. Linked providers and unlink hints

```http
GET    /api/user/linked-providers
DELETE /api/user/unlink-provider/:provider
POST   /api/user/set-primary-provider
```

The list answers with the sign-in methods on the account and, for each one, what an unlink would be told now:

```json
{
  "providers": ["email", "google"],
  "primaryProvider": "google",
  "unlinkHints": { "email": "not_removable", "google": "allowed" },
  "primaryHints": { "email": "no_profile_to_sync", "google": "allowed" },
  "emailSignIn": "usable"
}
```

| Hint                  | Meaning                                                                      |
| --------------------- | ---------------------------------------------------------------------------- |
| `allowed`             | The unlink would go through.                                                 |
| `last_sign_in_method` | The unlink would be refused with `400 CANNOT_UNLINK_LAST_PROVIDER`.          |
| `not_removable`       | Email sign-in is not a link. An unlink of it answers `400 VALIDATION_ERROR`. |

Email sign-in counts as a remaining way in only while password sign-in or magic links are enabled. With both off, the last provider stays. Passkeys do not count for an unlink.

`unlinkHints` comes from the rule the unlink asks, and it is advice: the unlink still decides, so a page handles a refusal as well. The field is optional. A client that does not know it can ignore it.

`primaryHints` says the same for choosing the provider that profile sync follows:

| Hint                 | Meaning                                                                            |
| -------------------- | ---------------------------------------------------------------------------------- |
| `allowed`            | The choice would go through. This includes the provider that is primary already.   |
| `no_profile_to_sync` | Email sign-in has no provider profile. Choosing it answers `400 VALIDATION_ERROR`. |

Every linked provider can be primary, so only email sign-in is refused. A provider that is not linked answers `400 PROVIDER_NOT_LINKED` and is not listed. The field is optional and is advice in the same way.

`providers` lists `email` on every account that was created for an address, whatever the deployment has switched on. `emailSignIn` says whether that address can sign in now:

| Value          | Meaning                                                                           |
| -------------- | --------------------------------------------------------------------------------- |
| `usable`       | Password sign-in or magic links are enabled.                                      |
| `switched_off` | Both are off. The address still identifies the account and nobody signs in by it. |

It comes from the same reading the unlink rule counts email sign-in with. The field is absent when `providers` has no `email`, and a client that does not know it can ignore it.

## Adding a new OAuth provider

Follow these steps to add a new provider:

### Step 1: Add provider constant

Register the provider identifier in `backend/src/common/constants/oauth-providers.ts`:

```typescript
export const OAUTH_PROVIDERS = [
  // ... existing providers
  'newprovider',
] as const;

export type OAuthProviderName = (typeof OAUTH_PROVIDERS)[number];
```

### Step 2: Configure environment schema

Add validation keys in `backend/src/config/env.oauth.schema.ts`:

```typescript
OAUTH_NEWPROVIDER_CLIENT_ID: z.string().optional(),
OAUTH_NEWPROVIDER_CLIENT_SECRET: z.string().optional(),
OAUTH_NEWPROVIDER_CALLBACK_URL: z.string().url().optional(),
```

Expose the configuration values in `backend/src/config/oauth.config.ts`.

### Step 3: Implement provider strategy

Create `backend/src/auth/oauth/strategies/newprovider-oauth.strategy.ts` extending `BaseOAuthStrategy`:

```typescript
import { Injectable } from '@nestjs/common';
import { BaseOAuthStrategy } from '../base-oauth.strategy';
import { OAuthUserProfile } from '../oauth-provider.interface';

@Injectable()
export class NewProviderOAuthStrategy extends BaseOAuthStrategy {
  readonly name = 'newprovider';
  readonly displayName = 'New Provider';

  // Implement getAuthorizationUrl, exchangeCode, and getUserProfile
}
```

### Step 4: Register in OAuth registry

Import the new strategy in `backend/src/auth/oauth/oauth-registry.service.ts` and include it in the providers array in `OAuthModule`.

### Step 5: Update frontend

Add the provider branding and button component in `frontend/src/features/auth/components/`. The frontend will automatically show the button if `GET /api/auth/oauth/providers` returns the provider ID.
