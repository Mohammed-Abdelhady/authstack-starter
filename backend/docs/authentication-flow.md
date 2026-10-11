# Authentication Flow

This document describes the email-based authentication flow including signup, email verification, and login.

## Overview

The system uses a **two-step registration** process with email verification and **session-based authentication** with HTTP-only cookies.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Authentication Flow Overview                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐ │
│   │ Register │───>│  Email   │───>│ Activate │───>│  Access  │ │
│   │          │    │  Sent    │    │  Account │    │  System  │ │
│   └──────────┘    └──────────┘    └──────────┘    └──────────┘ │
│                                                                  │
│   ┌──────────┐    ┌──────────┐                                  │
│   │  Login   │───>│  Access  │                                  │
│   │          │    │  System  │                                  │
│   └──────────┘    └──────────┘                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. Registration (Signup)

### Endpoint

```
POST /api/auth/register
```

### Request Body

```json
{
  "email": "user@example.com"
}
```

### Validation Rules

| Field | Rules                                     |
| ----- | ----------------------------------------- |
| email | Valid email format, max 255 chars, unique |

A body that still carries `password` or `name` is an old client and is refused
with `REGISTRATION_CONTRACT_OUTDATED`, before any address look-up.

### Flow Diagram

```
Client                     Server                      Email Service
   │                          │                              │
   │  POST /register          │                              │
   │  {email}                 │                              │
   │─────────────────────────>│                              │
   │                          │                              │
   │                          │ 1. Check email not exists    │
   │                          │ 2. Generate 6-digit code     │
   │                          │ 3. Hash code                 │
   │                          │ 4. Store pending registration│
   │                          │                              │
   │                          │  Send activation email       │
   │                          │─────────────────────────────>│
   │                          │                              │
   │  200 OK                  │                              │
   │  {message, email}        │                              │
   │<─────────────────────────│                              │
```

### Response

**Success (200):**

```json
{
  "message": "Activation code sent to your email",
  "email": "user@example.com"
}
```

**Errors:**

- `400` - Validation error (invalid email)
- `400` - `REGISTRATION_CONTRACT_OUTDATED` for a body carrying a password or name
- `429` - Rate limit exceeded (5 per 15 minutes per IP)

### What Happens Behind the Scenes

1. **Email Check**: Verify the address does not already have an account
2. **Code Generation**: Generate cryptographically secure 6-digit code
3. **Code Hashing**: Hash the code before storing
4. **Pending Storage**: Store in `pending_registrations` collection with the
   configured code lifetime
5. **Email Delivery**: Send code via Nodemailer

**Important**: No credential is stored before the address is proved. The
password and name arrive with the code at activation. No user record is created
yet.

---

## 2. Account Activation

### Endpoint

```
POST /api/auth/activate
```

### Request Body

```json
{
  "email": "user@example.com",
  "code": "123456",
  "password": "SecurePass123",
  "name": "John Doe"
}
```

### Flow Diagram

```
Client                     Server                      Database
   │                          │                            │
   │  POST /activate          │                            │
   │  {email, code, password, │                            │
   │   name}                  │                            │
   │─────────────────────────>│                            │
   │                          │                            │
   │                          │ 1. Reserve one attempt     │
   │                          │ 2. Verify code hash once   │
   │                          │ 3. Hash password           │
   │                          │                            │
   │                          │ 4. One transaction:        │
   │                          │    consume the generation  │
   │                          │    and create the User     │
   │                          │───────────────────────────>│
   │                          │                            │
   │                          │ 5. Create Session          │
   │                          │───────────────────────────>│
   │                          │                            │
   │  200 OK                  │                            │
   │  Set-Cookie: sid=xxx     │                            │
   │  {requiresTwoFactor,     │                            │
   │   mustSignIn, user}      │                            │
   │<─────────────────────────│                            │
```

### Response

**Success (200):**

```json
{
  "message": "Account activated successfully",
  "requiresTwoFactor": false,
  "mustSignIn": false,
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "user",
    "isVerified": true
  }
}
```

Also sets HTTP-only cookie: `sid=<session_token>`

If the account is committed but the session could not be issued, the body is
`{requiresTwoFactor: false, mustSignIn: true, user: null}` with no cookie: the
client sends the user to sign in normally.

**Errors:**

- `400` - Wrong, missing, expired or locked code; all four answer one
  `ACTIVATION_CODE_INVALID` body

### Security Features

- **Code Expiry**: the configured `ACTIVATION_CODE_EXPIRES_IN` (default 15
  minutes)
- **Max Attempts**: 5 failed attempts, after which the record is locked and
  cannot be used
- **Hashed Storage**: Code is hashed, not stored in plain text

### Confirming an Admin Email Change

An administrator can move an account to a new address. The server mails a code
to the new address and the user confirms it without a password; no session is
issued.

```
POST /api/auth/confirm-email-change
```

Request body:

```json
{
  "email": "new@example.com",
  "code": "123456"
}
```

The mail links to the web page `/auth/confirm-email-change`, which collects the
address and the code. The code must still match the account and the address
generation the change was issued under, so a superseded change confirms
nothing. A wrong, missing, expired or stale code answers `400`
`ACTIVATION_CODE_INVALID`.

An administrator can re-issue the code from the admin API:

```
POST /api/admin/users/:id/resend-email-change
```

It answers `429` `EMAIL_SEND_LIMIT_REACHED` when the address is over its
per-window mail cap, and `400` `EMAIL_SEND_FAILED` when the mail could not be
sent.

---

## 3. Login

### Endpoint

```
POST /api/auth/login
```

### Request Body

```json
{
  "email": "user@example.com",
  "password": "SecurePass123"
}
```

### Flow Diagram

```
Client                     Server                      Database
   │                          │                            │
   │  POST /login             │                            │
   │  {email, password}       │                            │
   │─────────────────────────>│                            │
   │                          │                            │
   │                          │ 1. Find user by email      │
   │                          │    (include password)      │
   │                          │───────────────────────────>│
   │                          │<───────────────────────────│
   │                          │                            │
   │                          │ 2. Compare password hash   │
   │                          │                            │
   │                          │ 3. Create session          │
   │                          │───────────────────────────>│
   │                          │                            │
   │  200 OK                  │                            │
   │  Set-Cookie: sid=xxx     │                            │
   │  {message, user}         │                            │
   │<─────────────────────────│                            │
```

### Response

**Success (200):**

```json
{
  "message": "Login successful",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "user",
    "isVerified": true
  }
}
```

**Errors:**

- `400` - Validation error
- `401` - Invalid credentials
- `429` - Rate limit exceeded (5 per 15 min per IP)

### Unverified Users

- Unverified users **CAN** login
- Response includes `"isVerified": false`
- Session is created normally
- **BUT**: Protected routes will return 403 until verified

---

## 4. Logout

### Endpoint

```
POST /api/auth/logout
```

### Flow

1. Extract session token from cookie
2. Invalidate session in database
3. Clear session cookie
4. Return success

### Response

**Success (200):**

```json
{
  "message": "Logged out successfully"
}
```

---

## 5. Session Management

### Session Cookie

```
Set-Cookie: sid=<token>; HttpOnly; Secure; SameSite=Strict; Max-Age=604800; Path=/
```

| Attribute | Value       | Purpose            |
| --------- | ----------- | ------------------ |
| HttpOnly  | true        | Prevent XSS access |
| Secure    | true (prod) | HTTPS only         |
| SameSite  | Strict      | Prevent CSRF       |
| Max-Age   | 604800      | 7 days             |

### Session Storage

Sessions are stored in MongoDB with:

- User reference
- Token (cryptographically random)
- User agent (browser info)
- IP address
- Expiry time (TTL index for auto-cleanup)
- Validity flag (for logout)

### Session Validation

On each protected request:

1. Extract `sid` cookie
2. Find session by token
3. Check `isValid` is true
4. Check `expiresAt` is in future
5. Attach user to request
6. Update `lastUsedAt`

---

## 6. Route Protection

### Public Routes (No Auth Required)

```
POST /api/auth/register
POST /api/auth/activate
POST /api/auth/confirm-email-change
POST /api/auth/login
GET  /health
```

### Protected Routes (Auth Required)

```
POST /api/auth/logout
GET  /api/user/profile
PATCH /api/user/profile
```

The full list is in [API routes](api-routes.md).

### Guard Hierarchy

```
Request
   │
   ▼
┌─────────────────┐
│ Is @Public()?   │──Yes──> Allow
└────────┬────────┘
         │ No
         ▼
┌─────────────────┐
│   AuthGuard     │──Fail──> 401 Unauthorized
└────────┬────────┘
         │ Pass
         ▼
┌─────────────────┐
│ Route guards?   │──No──> Allow
│ (Permission,    │
│  Roles)         │──Fail──> 403 Forbidden
└────────┬────────┘
         │ Pass
         ▼
      Allow
```

---

## 7. Email Templates

### Activation Email

```
Subject: Verify Your Email Address

Hi {name},

Thank you for registering! Please use the following
6-digit verification code to complete your registration:

        {code}

This code will expire in {N} minutes.

If you didn't request this code, you can safely ignore this email.

Best regards,
The Team
```

`{N}` is the configured `ACTIVATION_CODE_EXPIRES_IN` in minutes (15 with the
default lifetime).

### Email-Change Confirmation Email

```
Subject: Confirm your new email address

Hi,

An administrator changed the email address on your account. Open the
confirmation page and enter this code to finish the change:

{link to /auth/confirm-email-change}

Code: {code}

This code will expire in {N} minutes.

If you didn't expect this change, contact your administrator.

Best regards,
The Team
```

---

## 8. Environment Configuration

```bash
# SMTP (Nodemailer)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
EMAIL_FROM=noreply@yourapp.com

# Security
BCRYPT_ROUNDS=10

# Session
SESSION_COOKIE_NAME=sid
SESSION_COOKIE_MAX_AGE=604800000  # 7 days in ms

# Activation
ACTIVATION_CODE_EXPIRES_IN=900000  # 15 min in ms
ACTIVATION_MAX_ATTEMPTS=5
```

---

## 9. Error Codes Reference

| Code | Meaning           | When                                         |
| ---- | ----------------- | -------------------------------------------- |
| 400  | Bad Request       | Validation errors                            |
| 401  | Unauthorized      | Invalid credentials, invalid/expired session |
| 403  | Forbidden         | Email not verified                           |
| 409  | Conflict          | Email already exists                         |
| 429  | Too Many Requests | Rate limit exceeded                          |

---

## 10. Security Considerations

1. **Password Storage**: bcrypt with configurable rounds (default 10)
2. **Activation Codes**: Cryptographically random, hashed before storage
3. **Session Tokens**: 32 bytes random, stored as hex
4. **Rate Limiting**: Prevents brute force attacks
5. **HTTP-only Cookies**: Prevents XSS token theft
6. **SameSite Cookies**: Prevents CSRF attacks
7. **Constant-time Comparison**: bcrypt handles timing attacks
