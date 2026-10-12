# Magic Link Setup Guide

This guide explains how to turn on passwordless sign-in, where a one-time link mailed to an address replaces the password.

## Overview

A magic link is a token mailed to an address. Following it signs the address holder in, and creates their account if they do not have one yet.

**How a sign-in runs**:

1. The client posts an address to `POST /api/auth/magic-link/request`.
2. The backend stores the sha256 of a fresh token and mails a link to the address.
3. The client page behind that link reads the token out of the query string and posts it to `POST /api/auth/magic-link/verify`.
4. The backend spends the token, sets the session cookie and returns the account.

**What this needs**: a working SMTP configuration.

<!-- feature:email-password:start -->

For email and password setup, see [setup-smtp.md](setup-smtp.md).

<!-- feature:email-password:end -->

---

## Turning it on

Add to `backend/.env`:

```bash
# SMTP has to work first
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
EMAIL_FROM=noreply@yourdomain.com

# Magic links
MAGIC_LINK_ENABLED=true
MAGIC_LINK_EXPIRES_IN=900000
MAGIC_LINK_MAX_PER_HOUR=5
```

Left out entirely, `MAGIC_LINK_ENABLED` follows SMTP: links are on when `SMTP_HOST` and `EMAIL_FROM` are both set, and off when either is missing. Set it explicitly to keep the two decisions apart.

`CLIENT_URL` is the origin of the mailed link. A deployment that serves the frontend from `https://app.example.com` has to set it, or links point at `http://localhost:3000`.

---

## Environment Variables Reference

| Variable                  | Description                                 | Default                    |
| ------------------------- | ------------------------------------------- | -------------------------- |
| `MAGIC_LINK_ENABLED`      | Turns the routes on or off                  | on when SMTP is configured |
| `MAGIC_LINK_EXPIRES_IN`   | Link lifetime in milliseconds               | `900000` (15 minutes)      |
| `MAGIC_LINK_MAX_PER_HOUR` | Links mailed to one address per hour        | `5`                        |
| `AUTH_PASSWORD_ENABLED`   | Password sign-up, sign-in, reset and change | `true`                     |
| `CLIENT_URL`              | Origin the mailed link points at            | `http://localhost:3000`    |

---

## Running magic links on their own

Set `AUTH_PASSWORD_ENABLED=false` alongside `MAGIC_LINK_ENABLED=true`. `POST /api/auth/register`, `/activate`, `/resend-activation`, `/login`, `/forgot-password` and `/reset-password` then answer `404` with the error code `FEATURE_DISABLED`, as does `POST /api/user/password`, and `GET /api/auth/methods` reports `password: false`, so a client built against that endpoint stops rendering the password form.

Logout stays open. So does `POST /api/auth/confirm-email-change`, which confirms an address an administrator moved an account to and has nothing to do with passwords.

Accounts created by a magic link have no password hash. They can request a password later through the reset flow, if password sign-in is on. Accounts that have a password can also sign in with a link; the two methods do not exclude each other.

---

## Routes

### Request a link

```http
POST /api/auth/magic-link/request
Content-Type: application/json

{ "email": "user@example.com" }
```

Answers `200` with the same body for an address with an account, an address without one, and an address that has already hit the hourly cap:

```json
{
  "success": true,
  "data": { "email": "user@example.com" },
  "message": "If the address can sign in, a link has been sent"
}
```

Rate limited to 5 requests per 15 minutes per caller, on top of the per-address hourly cap.

### Spend a link

```http
POST /api/auth/magic-link/verify
Content-Type: application/json

{ "token": "<token from the query string>" }
```

Answers `200` with the account and sets the session cookie:

```json
{
  "success": true,
  "data": {
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

A token that is unknown, already spent, expired, or belongs to a deleted account answers `400` with `MAGIC_LINK_INVALID`. There is one error code on purpose: telling "expired" apart from "never existed" tells a caller which addresses have pending links.

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
      "oauth": [{ "id": "google", "displayName": "Google" }]
    }
  }
}
```

---

## The client page behind the link

The mailed link points at `${CLIENT_URL}/auth/magic-link/verify?token=...`, not at the backend. That page reads the token and posts it.

The indirection is the point. Mail scanners, link preview services and some clients fetch every URL in a message before a person sees it. A backend route that signs a caller in on a plain `GET` is spent by the first of those fetches, and the account holder gets an error. A `POST` that a page makes after it loads is not something a scanner issues.

For the same reason there is no `GET /api/auth/magic-link/verify`.

---

## What the backend stores

The `pendingmagiclinks` collection:

| Field        | Notes                                                                         |
| ------------ | ----------------------------------------------------------------------------- |
| `email`      | Lowercased address the link was mailed to                                     |
| `tokenHash`  | sha256 of the token, hex, unique. The token itself is mailed and never stored |
| `expiresAt`  | When the link stops working                                                   |
| `consumedAt` | Set by the request that spends the link, `null` before that                   |
| `requestIp`  | Address the request came from                                                 |
| `userAgent`  | Agent string of the request                                                   |

A TTL index removes each record an hour after it expires. The delay is deliberate: the per-address hourly cap counts records created in the last hour, so they have to outlive the link.

Spending a link is a single `findOneAndUpdate` on `{ tokenHash, consumedAt: null }`. Two requests carrying the same token cannot both win it.

---

## Troubleshooting

### Every request answers 404 with FEATURE_DISABLED

Magic links are off. Check `MAGIC_LINK_ENABLED`, and check `SMTP_HOST` and `EMAIL_FROM` when you left it unset. `GET /api/auth/methods` reports what the running process resolved.

### The request answers 200 but no mail arrives

The reply is the same whether or not a link was mailed, so start with the logs. `Magic link sent to ...` is written only when the link was handed to SMTP; `Magic link hourly cap reached for ...` means the address is over `MAGIC_LINK_MAX_PER_HOUR`; `Magic link request for a deleted account` means the account is soft-deleted and nothing was mailed.

A hand-off that fails is logged as `Failed to send sign-in link email requestId=<id> cause=<name>` and is not reported to the caller: the route still answers `200`. Take the request id from the `X-Request-Id` response header or the request log and search the logs for `requestId=<id>` to trace it. Check your SMTP configuration and your mail provider's delivery logs.

Watch the order while SMTP is broken: the pending record is written before the mail goes out, so five failed sends use up `MAGIC_LINK_MAX_PER_HOUR` for that address. Further requests then answer `200` and mail nothing until the hour passes. Fix SMTP first, then wait out the window or clear the address from `pendingmagiclinks`.

### The link opens the client but sign-in fails with MAGIC_LINK_INVALID

Either the link is older than `MAGIC_LINK_EXPIRES_IN`, or the token was already spent. Something fetching the link ahead of the account holder cannot spend it, since only a `POST` does, but a page that posts the token twice can. Post once per page load.

### Links point at localhost in production

`CLIENT_URL` is unset in the backend environment.

### Sign-in works but the session cookie is missing

The cookie is `SameSite=strict`, and `Secure` in production. The client and the API have to be same-site, and production needs HTTPS. This is the same requirement password sign-in has.

---

## Production Notes

- Keep `MAGIC_LINK_EXPIRES_IN` short. Fifteen minutes is the default; an hour is the outside limit worth considering, because a mailbox someone else reaches later is the main risk here.
- `MAGIC_LINK_MAX_PER_HOUR` caps how much mail one address can be made to receive. Raise it only if account holders genuinely request several links per hour.
- Use a dedicated transactional mail provider. A link that lands in spam is a sign-in that fails.
- Watch the `Magic link hourly cap reached` warnings. A run of them on one address means someone is using the request route to bombard a mailbox.
