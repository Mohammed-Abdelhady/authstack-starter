# Sign-in and session access

This guide covers password sign-in, session handling, and protected routes.

## Login

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

## Logout

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

## Session management

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

## Route protection

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

## Error code reference

| Code | Meaning           | When                                         |
| ---- | ----------------- | -------------------------------------------- |
| 400  | Bad Request       | Validation errors                            |
| 401  | Unauthorized      | Invalid credentials, invalid/expired session |
| 403  | Forbidden         | Email not verified                           |
| 409  | Conflict          | Email already exists                         |
| 429  | Too Many Requests | Rate limit exceeded                          |

---

## Security considerations

1. **Password Storage**: bcrypt with configurable rounds (default 10)
2. **Activation Codes**: Cryptographically random, hashed before storage
3. **Session Tokens**: 32 bytes random, stored as hex
4. **Rate Limiting**: Prevents brute force attacks
5. **HTTP-only Cookies**: Prevents XSS token theft
6. **SameSite Cookies**: Prevents CSRF attacks
7. **Constant-time Comparison**: bcrypt handles timing attacks
