# Passkeys Setup Guide

This guide explains how to turn passkeys on: signing in with the fingerprint reader, face scan or device PIN the user already unlocks their machine with, and no password anywhere in the flow.

## Overview

A passkey is a key pair. The private half stays on the authenticator, which is the phone, the laptop's secure enclave or a security key; the server only ever stores the public half. Signing in means the authenticator signs a random challenge the server just handed out, so there is no shared secret to steal, and nothing that can be phished onto the wrong site: the browser refuses to use a credential outside the domain it was registered for.

**How a sign-in runs**:

1. The client posts to `POST /api/auth/passkeys/login/options` and gets back the challenge, in a `pk_challenge` cookie and in the body.
2. The browser prompts, the user confirms with a fingerprint or a PIN, and hands back a signed assertion.
3. The client posts it to `POST /api/auth/passkeys/login/verify`. The backend checks the signature against the stored public key, sets the session cookie and returns the account.

No email address is asked for at any point. The credentials are discoverable, so the browser lists the accounts it holds for this site and the user picks one.

**What this needs**: `OAUTH_STATE_SECRET`, which is required at boot anyway. No SMTP, no extra service.

---

## Turning it on

Add to `backend/.env`:

```bash
PASSKEYS_ENABLED=true
```

That is the whole minimum. The relying party settings below default from `CLIENT_URL`, which is right whenever the browser reaches the app at that URL.

The challenge cookie is signed with a key derived from `OAUTH_STATE_SECRET` using HKDF under a passkey-specific label, so it cannot stand in for the OAuth state key or the other way round. Without that secret the passkey routes answer `503 PASSKEY_NOT_CONFIGURED`.

---

## RP ID and origin

Two values decide which credentials a browser will use, and getting them wrong is the usual reason a passkey stops working.

**RP ID** (`WEBAUTHN_RP_ID`) is a bare domain: `example.com`, no scheme, no port, no path. A credential is bound to it forever. The browser will use a credential whose RP ID is the current domain or a parent of it, so a credential registered under `example.com` works on `app.example.com`, but one registered under `app.example.com` does not work on `example.com` or on `other.example.com`.

**Origin** (`WEBAUTHN_ORIGIN`) is the full origin the browser is on: scheme, host and port, no trailing slash. `https://example.com`, or `http://localhost:3000` in development. The backend refuses an assertion that came from anywhere else.

Left unset, both follow `CLIENT_URL`: the RP ID is its hostname, the origin is its origin.

**Pick the RP ID once.** Changing it makes every registered passkey unusable, because the browser will no longer offer credentials scoped to the old domain. If the app might ever move to a subdomain, register under the parent domain from the start.

### Localhost

`localhost` is the one exception to the HTTPS rule. Browsers treat it as a secure context, so `WEBAUTHN_RP_ID=localhost` with `WEBAUTHN_ORIGIN=http://localhost:3000` works over plain HTTP with no certificate. An IP address does not: `127.0.0.1` is not a valid RP ID.

### Production

Production needs HTTPS. A passkey ceremony on `http://` outside localhost is refused by the browser before the backend sees it.

If the client and the API sit on different hosts, the RP ID follows the **client**, because that is the page the browser runs the ceremony on. A client at `https://app.example.com` talking to an API at `https://api.example.com` needs `WEBAUTHN_RP_ID=example.com` or `app.example.com`, never `api.example.com`.

Behind a reverse proxy, set `WEBAUTHN_ORIGIN` explicitly to the public URL. The origin the browser reports is the public one, not whatever the app binds to internally.

---

## Environment Variables Reference

| Variable           | Description                                      | Default                  |
| ------------------ | ------------------------------------------------ | ------------------------ |
| `PASSKEYS_ENABLED` | Turns the `/auth/passkeys` routes on or off      | `true`                   |
| `WEBAUTHN_RP_ID`   | Domain the credentials are bound to, a bare host | hostname of `CLIENT_URL` |
| `WEBAUTHN_RP_NAME` | Name shown in the browser prompt                 | `Auth Boilerplate`       |
| `WEBAUTHN_ORIGIN`  | Origin the browser has to be on                  | origin of `CLIENT_URL`   |

The web app shows its own name, `Auth App`, in the tab title and the header. That name is `common.appName` in the frontend message files and the server does not read it. Set `WEBAUTHN_RP_NAME` to the name your users see, or the passkey prompt says `Auth Boilerplate`.

Setting `PASSKEYS_ENABLED=false` closes the routes with `404 FEATURE_DISABLED` and makes `GET /api/auth/methods` report `passkeys: false`.

---

## Routes

### Register a passkey

Needs a session. The account is already signed in; this adds a way back in.

```http
POST /api/auth/passkeys/register/options
```

Returns the options to pass to `navigator.credentials.create()`, and sets `pk_challenge` for five minutes. Passkeys already on the account are listed in `excludeCredentials`, so an authenticator that holds one says so instead of registering a duplicate.

```http
POST /api/auth/passkeys/register/verify
Content-Type: application/json

{ "response": { ... }, "name": "MacBook Touch ID" }
```

`response` is the credential from `navigator.credentials.create()`, serialised. `name` is optional and defaults to `Passkey`. The reply is the stored summary:

```json
{
  "success": true,
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "name": "MacBook Touch ID",
    "deviceType": "multiDevice",
    "backedUp": true,
    "createdAt": "2026-01-05T10:00:00.000Z",
    "lastUsedAt": null
  },
  "message": "Passkey added"
}
```

`backedUp` says the credential is synced to a provider keychain, so it survives losing the device. `deviceType` is `multiDevice` for a synced credential and `singleDevice` for one that lives on one authenticator only.

### Sign in

Both routes are open, and both are rate limited.

```http
POST /api/auth/passkeys/login/options
```

An `{ "email": "..." }` body is accepted so a client can keep one sign-in form, and ignored. `allowCredentials` comes back empty either way, which is what stops the route from confirming whether an address has an account.

```http
POST /api/auth/passkeys/login/verify
Content-Type: application/json

{ "response": { ... } }
```

Same reply as every other sign-in route:

```json
{
  "success": true,
  "data": { "requiresTwoFactor": false, "user": { "id": "...", "email": "..." } },
  "message": "Login successful"
}
```

### Manage

All three need a session, and all three are scoped to the signed-in account: an id belonging to someone else reads as `404 PASSKEY_NOT_FOUND` rather than as forbidden.

```http
GET    /api/auth/passkeys
PATCH  /api/auth/passkeys/:id     { "name": "iPhone" }
DELETE /api/auth/passkeys/:id
```

Delete is refused with `409 PASSKEY_LAST_SIGN_IN_METHOD` when it is the account's only passkey **and** the account has no password to sign in with, no linked OAuth provider, and magic links are off. Any one of those, and the passkey goes.

The list answer carries the same decision ahead of time, so a page can say why before anyone tries:

```json
{ "passkeys": [{ "id": "…", "name": "Laptop" }], "canRemove": false }
```

`canRemove` is `false` when a delete would be refused with `PASSKEY_LAST_SIGN_IN_METHOD` right now. It comes from the rule the delete asks, and it is advice: the delete still decides, so a page handles the `409` as well. The field is optional. A client that does not know it can ignore it.

---

## Passkeys and the second factor

A passkey that verified the user, with a PIN, a fingerprint or a face scan, has collected two factors in one gesture: the key on the device, and something only its owner can supply. That sign-in is let through even on an account with TOTP enabled, which is what WebAuthn is designed for and what the platforms do.

A passkey that only proved possession, with no user verification, still owes the code. That sign-in answers `requiresTwoFactor: true` and leaves the `mfa_challenge` cookie, exactly like the password path.

A security key used without a PIN or a biometric cannot be both steps. After it opens the sign-in, the second step refuses any passkey that does not verify the user, and the person finishes with their code or a recovery code.

A passkey can also answer a challenge that some other method opened. The client fetches `POST /api/auth/passkeys/login/options` while the `mfa_challenge` cookie is set, then posts the assertion to the two-factor route:

```http
POST /api/auth/2fa/verify
Content-Type: application/json

{ "passkeyResponse": { ... } }
```

The credential has to belong to the account the challenge was issued for; one registered elsewhere answers `401 PASSKEY_VERIFICATION_FAILED`.

---

## What is stored

One document per credential: the public key, the credential id, the signature counter, the transports, the name, and when it was last used. No private key material ever reaches the server, so the collection leaking gives an attacker nothing they can sign with.

The counter is checked on every sign-in. An authenticator that counts and reports a number that fails to move forward has been cloned, and the assertion is refused with `401 PASSKEY_VERIFICATION_FAILED`. Authenticators that do not count report zero forever and are left alone.

---

## Troubleshooting

**The browser prompt never appears.** The page is not on a secure context. Use `https://`, or `localhost` in development.

**`PASSKEY_VERIFICATION_FAILED` on every sign-in, registration worked.** `WEBAUTHN_ORIGIN` or `WEBAUTHN_RP_ID` changed between the two. Check both against what the browser actually reports; a trailing slash or a missing port in the origin is enough.

**`PASSKEY_CHALLENGE_INVALID`.** The `pk_challenge` cookie did not arrive. It is `SameSite=Strict`, so a ceremony started on a different site will not carry it, and it expires after five minutes.

**Existing passkeys stopped working after a deploy.** The RP ID changed. Credentials cannot be migrated between RP IDs; the users have to register again with another sign-in method first.

**`503 PASSKEY_NOT_CONFIGURED`.** `OAUTH_STATE_SECRET` is not set.
