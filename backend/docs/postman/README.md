# Postman collection

This directory contains the Postman collection and environment files for testing backend endpoints.

## Files

- `authstack-starter-api.postman_collection.json`: Complete collection of backend requests organized by domain.
- `dev.json`: Local development environment pointing to `http://localhost:5000/api`.
- `staging.json`: Staging server environment.
- `production.json`: Production server environment.

## Quick start

### 1. Import collection

1. Open Postman.
2. Click **Import**.
3. Select `authstack-starter-api.postman_collection.json`.

### 2. Import environment

1. Open Postman **Environments**.
2. Click **Import**.
3. Select `dev.json` for local development.
4. Set the active environment to **Development**.

### 3. Authenticate

The backend uses HTTP-only session cookies (`sid` in development, `__Host-sid` in production).

1. Execute the **Login** request under the **Authentication** folder.
2. Postman stores the session cookie in its cookie jar automatically.
3. Subsequent requests to protected routes will include the session cookie.

## Collection structure

The collection contains the following folders:

- **Authentication:** Registration, activation code verification, login, logout, password resets, and dynamic auth method discovery.
- **Magic Link:** Passwordless login email dispatch and token verification.
- **Two-Factor Authentication:** TOTP secret generation, 2FA activation, challenge verification, and recovery code regeneration.
- **Passkeys:** WebAuthn registration and authentication flows.
- **OAuth:** Provider discovery and OAuth start routes.
- **User Profile & Sessions:** Profile retrieval and updates, password changes, linked provider management, and active session revocation.
- **Roles:** Role list, creation, update, and deletion endpoints.
- **Admin Users & Permissions:** User listing, role assignment, account activation toggles, and direct permission assignment.
- **Health:** Root health check endpoint (`GET /health`).
