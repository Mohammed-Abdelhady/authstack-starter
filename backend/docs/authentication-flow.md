# Authentication Flow

This guide covers registration and account activation. Separate guides cover sign-in, session access, and email changes.

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

See [admin email changes](authentication-email.md#admin-email-changes).

## 3. Login

See [sign-in details](authentication-access.md#login).

## 4. Logout

See [logout details](authentication-access.md#logout).

## 5. Session Management

See [session management](authentication-access.md#session-management).

## 6. Route Protection

See [route protection](authentication-access.md#route-protection).

## 7. Email Templates

See [email templates](authentication-email.md#email-templates).

## 8. Environment Configuration

See [authentication settings](authentication-email.md#environment-configuration).

## 9. Error Codes Reference

See the [error code reference](authentication-access.md#error-code-reference).

## 10. Security Considerations

See [security considerations](authentication-access.md#security-considerations).
