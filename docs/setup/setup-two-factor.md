# Two-Factor Setup Guide

This guide explains how to turn on the TOTP second factor: the six digit code an authenticator app shows, asked for after the password, the magic link or the OAuth provider has already done its part.

## Overview

TOTP is a code derived from a shared secret and the clock. The account holder scans a QR code once, and the app then produces a new code every 30 seconds without talking to anything.

**How a sign-in runs**:

1. The user signs in as usual, with a password, a magic link or an OAuth provider.
2. The account has a confirmed second factor, so the backend creates no session. It sets a short lived `mfa_challenge` cookie instead and answers `requiresTwoFactor: true`.
3. The client collects a code and posts it to `POST /api/auth/2fa/verify`.
4. The backend checks the code, clears the challenge cookie, sets the session cookie and returns the account.

Accounts without a second factor are unaffected. They sign in the way they always did, and the reply carries `requiresTwoFactor: false`.

**What this needs**: `TOTP_ENCRYPTION_KEY`. No SMTP, no extra service.

---

## Turning it on

Generate the key:

```bash
openssl rand -base64 32
```

Add to `backend/.env`:

```bash
TWO_FACTOR_ENABLED=true
TOTP_ENCRYPTION_KEY=<the 44 character string from the command above>
```

The key does two jobs. It encrypts every TOTP secret at rest with AES-256-GCM, and a second key derived from it with HKDF signs the login challenge cookie. One value in the environment, two keys that cannot be made to stand in for each other.

Keep it out of source control and back it up. Losing it locks every enrolled account out of its authenticator app; those users then need their recovery codes, or an administrator to clear `twoFactor` on the account.

The key is optional at boot on purpose. A deployment that never turns two-factor on should not have to hold one, so a missing or wrong-length key is reported by the first request that needs it, as `503 TWO_FACTOR_NOT_CONFIGURED`, rather than by a failed start.

---

## Environment Variables Reference

| Variable              | Description                                                  | Default |
| --------------------- | ------------------------------------------------------------ | ------- |
| `TWO_FACTOR_ENABLED`  | Turns the `/auth/2fa` routes on or off                       | `true`  |
| `TOTP_ENCRYPTION_KEY` | 32 bytes of base64, encrypts secrets and signs the challenge | unset   |

Setting `TWO_FACTOR_ENABLED=false` closes the routes with `404 FEATURE_DISABLED` and makes `GET /api/auth/methods` report `twoFactor: false`. Accounts that already have a second factor then sign in with one factor, because a challenge they could not answer would lock them out.

---

## Routes

### Start setup

```http
POST /api/auth/2fa/setup
Content-Type: application/json

{ "password": "current-password" }
```

Needs a session, and proof that the person at the keyboard is the account holder. Accounts with a password send it in the body. Passwordless accounts send nothing and need a session younger than five minutes; an older one answers `401 REAUTH_REQUIRED`.

```json
{
  "success": true,
  "data": {
    "otpauthUrl": "otpauth://totp/Auth%20Boilerplate:user%40example.com?secret=NYITGE7DZ7KUSQJFKLHJL2LZ6Z5IDTV7&issuer=Auth%20Boilerplate",
    "secret": "NYITGE7DZ7KUSQJFKLHJL2LZ6Z5IDTV7"
  },
  "message": "Scan the code, then confirm it"
}
```

Render `otpauthUrl` as a QR code in the client, and show `secret` for people typing it in by hand. The backend does not draw the QR code: turning a URL into an image is a client concern, and shipping an image library for it is not worth the dependency.

Authenticator apps list newly enrolled accounts under `Auth App`. Existing enrollments keep their stored label and their codes remain valid.

Nothing about the account changes yet. The secret is stored unconfirmed, so a setup abandoned halfway leaves sign-in exactly as it was. Calling setup again replaces the pending secret.

### Confirm

```http
POST /api/auth/2fa/confirm
Content-Type: application/json

{ "code": "123456" }
```

Checks a first code against the pending secret, turns the factor on and returns the recovery codes:

```json
{
  "success": true,
  "data": {
    "recoveryCodes": ["K3M7QRTVWX", "A2B4C6D8EF", "..."]
  },
  "message": "Store these codes somewhere safe. They are not shown again."
}
```

An account that already has a confirmed factor answers `409 TWO_FACTOR_ALREADY_ENABLED`. A confirm without a preceding setup answers `400 TWO_FACTOR_SETUP_REQUIRED`.

### Answer a challenge

```http
POST /api/auth/2fa/verify
Content-Type: application/json

{ "code": "123456" }
```

Public, and reads the `mfa_challenge` cookie the sign-in left behind. Send `recoveryCode` instead of `code` when the app is unavailable. Answers the normal login body and sets the session cookie:

```json
{
  "success": true,
  "data": {
    "requiresTwoFactor": false,
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "email": "user@example.com",
      "name": "user",
      "role": "user",
      "authProvider": "email",
      "isVerified": true,
      "permissions": ["users:read"]
    }
  },
  "message": "Login successful"
}
```

Rate limited to 10 requests per 15 minutes per caller. Five wrong codes end that particular challenge with `401 TWO_FACTOR_CHALLENGE_INVALID`, and the user starts the sign-in again.

### Turn it off

```http
POST /api/auth/2fa/disable
Content-Type: application/json

{ "code": "123456", "password": "current-password" }
```

Needs a code or a recovery code, and the password as well when the account has one. Clears the secret, the recovery codes and the replay marker.

### Replace the recovery codes

```http
POST /api/auth/2fa/recovery-codes/regenerate
Content-Type: application/json

{ "code": "123456" }
```

Returns ten new codes and drops the old batch, spent or not.

### List sign-in methods

```http
GET /api/auth/methods
```

```json
{
  "success": true,
  "data": {
    "methods": {
      "password": true,
      "magicLink": true,
      "twoFactor": true,
      "oauth": [{ "id": "google", "displayName": "Google" }]
    }
  }
}
```

`GET /api/user/profile` carries `twoFactorEnabled`, so an account page knows which of setup and disable to offer.

---

## What a sign-in returns when a code is owed

The JSON routes, `POST /api/auth/login` and `POST /api/auth/magic-link/verify`, answer `200` with no session:

```json
{
  "success": true,
  "data": { "requiresTwoFactor": true, "user": null },
  "message": "Enter the code from your authenticator app"
}
```

The OAuth callback is a browser redirect rather than a JSON reply, so it redirects to `${CLIENT_URL}/auth/2fa?redirect=<the path the user was heading to>` instead of the usual callback page.

---

## Recovery codes

Ten codes of ten base32 characters, handed out once at confirm and once more on every regenerate. Only their sha256 hashes are stored, so a database copy does not yield usable codes, and a lost batch cannot be reprinted.

Each code works once. Spending one marks it used and leaves the other nine. A code is accepted whichever way it is retyped: case is ignored, and spaces and dashes are stripped, so a value pasted out of a password manager still matches.

A recovery code stands in for the app anywhere a code is asked for, at verify and at disable. It is not accepted at confirm or at regenerate, since both of those are proof that the app itself works.

Regenerating replaces the whole batch. Tell users so, or they will keep an obsolete printout.

---

## What the backend stores

On the user document, under `twoFactor`:

| Field           | Notes                                                              |
| --------------- | ------------------------------------------------------------------ |
| `enabled`       | `true` only after a first correct code                             |
| `secret`        | `{ ciphertext, iv, tag }`, AES-256-GCM under `TOTP_ENCRYPTION_KEY` |
| `confirmedAt`   | When the factor was turned on, `null` while a secret is pending    |
| `recoveryCodes` | `{ hash, usedAt }` per code, sha256 hex                            |
| `lastUsedStep`  | Highest TOTP step already spent                                    |

It is a new optional subdocument, so no migration is needed. Accounts written before it existed read back with the defaults, and `enabled` is `false` until someone runs setup.

`lastUsedStep` is what stops a replay. A code is good for 30 seconds and the check accepts one step either side, so without it, someone who reads a code off a screen has a window to use it again. Every accepted code records its step, and a step at or below the last one is refused.

The `twofactorchallenges` collection holds one record per half-finished sign-in:

| Field       | Notes                                            |
| ----------- | ------------------------------------------------ |
| `user`      | Account the sign-in belongs to                   |
| `nonceHash` | sha256 of the nonce inside the cookie, unique    |
| `attempts`  | Wrong codes so far, capped at five               |
| `expiresAt` | Five minutes after the sign-in, with a TTL index |

The cookie value is `<base64url payload>.<base64url HMAC-SHA256>`, the same shape the OAuth state cookie uses. The count of wrong codes lives in the record rather than in the token on purpose: a client holds its own cookies, so a count carried in the token could be reset by replaying an earlier copy of it.

---

## Troubleshooting

### Every 2FA request answers 404 with FEATURE_DISABLED

`TWO_FACTOR_ENABLED` is `false`. `GET /api/auth/methods` reports what the running process resolved.

### Setup answers 503 with TWO_FACTOR_NOT_CONFIGURED

`TOTP_ENCRYPTION_KEY` is unset, or does not decode to 32 bytes. `openssl rand -base64 32` produces a 44 character string ending in `=`. A value that is present but blank counts as unset.

### Verify answers 503 with TWO_FACTOR_NOT_CONFIGURED

The key changed since the secret was written, so the stored secret no longer decrypts. Put the old key back. If it is gone, clear `twoFactor` on the affected accounts and have them enroll again.

### Codes are always rejected

Almost always clock drift on the device or the server. TOTP compares 30 second steps, and the check allows one step either side, so a machine more than about a minute out fails every code. Check NTP on the server first, then the automatic date setting on the phone.

### The same code works once and then fails

That is the replay guard, not a bug. Wait for the app to show the next code.

### Verify answers 401 with TWO_FACTOR_CHALLENGE_INVALID

The challenge is over five minutes old, was already answered, ran out of tries, or the cookie never arrived. Sign in again to open a new one.

If the cookie never arrives, it is the same constraint the session cookie has: `mfa_challenge` is `SameSite=strict`, and `Secure` in production, so the client and the API have to be same-site and production needs HTTPS.

### An account is locked out

The account holder has neither the app nor a recovery code. There is no backend route for this, on purpose. Clear `twoFactor` on their user document from the database, then have them run setup again.

---

## Production Notes

- Back up `TOTP_ENCRYPTION_KEY` with your other secrets. It is not derivable and not rotatable without re-enrolling every account.
- Rotating the key means decrypting every stored secret with the old key and re-encrypting with the new one. Nothing in the codebase does this; plan for downtime or write a one-off script.
- Keep the server clock on NTP. Drift shows up as codes that are valid on the phone and rejected by the backend.
- The verify route is throttled per caller, and each challenge tolerates five wrong codes. Together those cap guessing at a rate a six digit code survives.
- Recovery codes are the whole fallback. Make the client insist that they are saved before it closes the confirm screen.
