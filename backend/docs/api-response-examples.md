# API response examples

Endpoint-specific response bodies are collected here. See [API response formats and error codes](api-responses.md) for the shared response contract.

## Endpoint Examples

### POST /auth/register

**Success Response:**

```json
{
  "success": true,
  "data": {
    "email": "user@example.com"
  },
  "message": "If an account exists, a code has been sent"
}
```

**Error Response (old-shape body carrying a password or name):**

```json
{
  "success": false,
  "error": {
    "code": "REGISTRATION_CONTRACT_OUTDATED",
    "message": "Registration takes the email address only; send the password and name when activating"
  }
}
```

An address that already has an account answers the same success body as a free
one; it never answers `EMAIL_ALREADY_EXISTS`.

### POST /auth/activate

**Success Response:**

```json
{
  "success": true,
  "data": {
    "requiresTwoFactor": false,
    "mustSignIn": false,
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "email": "user@example.com",
      "name": "John Doe",
      "role": "user",
      "isVerified": true
    }
  },
  "message": "Account activated successfully"
}
```

When the account is committed but the session could not be issued, `user` is
`null`, `mustSignIn` is `true`, and no session cookie is set.

**Error Response (Wrong, missing, expired or locked code):**

The same body is returned in all four cases.

```json
{
  "success": false,
  "error": {
    "code": "ACTIVATION_CODE_INVALID",
    "message": "Invalid or expired activation code"
  }
}
```

### POST /auth/confirm-email-change

**Success Response:**

```json
{
  "success": true,
  "data": {
    "message": "Email address confirmed. Sign in to continue."
  }
}
```

No session cookie is set; the user signs in normally.

**Error Response (wrong, missing, expired or stale code):**

```json
{
  "success": false,
  "error": {
    "code": "ACTIVATION_CODE_INVALID",
    "message": "Invalid or expired activation code"
  }
}
```

### POST /admin/users/:id/resend-email-change

**Success Response:**

```json
{
  "success": true,
  "data": {
    "message": "Confirmation email sent"
  }
}
```

**Error Response (per-address mail cap in force):**

```json
{
  "success": false,
  "error": {
    "code": "EMAIL_SEND_LIMIT_REACHED",
    "message": "Too many confirmation emails sent to this address; try again in 15 minutes"
  }
}
```

**Error Response (mail could not be sent, or no address is waiting to be confirmed):**

```json
{
  "success": false,
  "error": {
    "code": "EMAIL_SEND_FAILED",
    "message": "Failed to send verification email"
  }
}
```

### POST /auth/reset-password

**Success Response:**

```json
{
  "success": true,
  "data": {
    "message": "Password reset successful"
  },
  "message": "Your password has been reset successfully"
}
```

**Error Response (Wrong, missing, expired or locked code):**

The same body is returned in all four cases.

```json
{
  "success": false,
  "error": {
    "code": "PASSWORD_RESET_CODE_INVALID",
    "message": "Invalid or expired password reset code"
  }
}
```

### POST /auth/login

**Success Response:**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "email": "user@example.com",
      "name": "John Doe",
      "role": "user",
      "isVerified": true
    }
  },
  "message": "Login successful"
}
```

**Error Response (Invalid credentials):**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or password"
  }
}
```

### POST /auth/logout

**Success Response:**

```json
{
  "success": true,
  "data": {
    "message": "Logout successful"
  }
}
```

**Error Response (Invalid session):**

```json
{
  "success": false,
  "error": {
    "code": "SESSION_INVALID",
    "message": "Invalid session"
  }
}
```

---
