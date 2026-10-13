# Environment variables and operational considerations

[Guide overview](project.md)

### Environment Variables

#### Backend Environment Variables

```bash
# Server Configuration
PORT=3000                                   # Server port (default: 3000)
NODE_ENV=development                        # Environment: development | production | test

# Database
MONGO_URI=mongodb://localhost:27017/authboiler  # MongoDB connection string
MONGO_TEST_URI=mongodb://localhost:27017/authboiler-test  # Test database

# Frontend URL (for CORS and email links)
CLIENT_URL=http://localhost:3000            # Frontend application URL

# Session
SESSION_COOKIE_NAME=sid
SESSION_COOKIE_MAX_AGE=604800000

# OAuth / passkey state signing (generate with: openssl rand -base64 48)
OAUTH_STATE_SECRET=your-super-secret-oauth-state-key-min-32-chars

# Native DPoP nonce signing (required when AUTH_NATIVE_ENABLED=true; generate with: openssl rand -hex 32)
AUTH_NATIVE_ENABLED=false
AUTH_NATIVE_DPOP_REQUIRED=false
AUTH_NATIVE_DPOP_NONCE_SECRET=your-secure-native-dpop-nonce-secret

# Email Service (SendGrid)
MAIL_KEY=SG.your-sendgrid-api-key          # SendGrid API key
EMAIL_FROM=noreply@yourdomain.com           # Sender email address
EMAIL_FROM_NAME=Your App Name               # Sender name

# OAuth Configuration
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret

FACEBOOK_APP_ID=your-facebook-app-id
FACEBOOK_APP_SECRET=your-facebook-app-secret

# Rate Limiting
THROTTLE_TTL=60                             # Rate limit window (seconds)
THROTTLE_LIMIT=10                           # Max requests per window

# Security
BCRYPT_ROUNDS=10                            # Bcrypt work factor (10-12 recommended)
```

#### Frontend Environment Variables

```bash
# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:3000/api    # Backend API base URL

# OAuth (Public Keys)
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
NEXT_PUBLIC_FACEBOOK_APP_ID=your-facebook-app-id

# App Configuration
NEXT_PUBLIC_APP_NAME=AuthStack Starter
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Error Handling Patterns

#### Backend Error Response Format

All errors return consistent structure:

```typescript
{
  statusCode: number,      // HTTP status code
  message: string,         // User-friendly error message
  error?: string,          // Error type (e.g., "Validation Error")
  details?: unknown            // Additional error details (dev only)
}
```

#### Error Categories

-   **400 Bad Request**: Invalid input, validation failures
-   **401 Unauthorized**: Missing or invalid authentication
-   **403 Forbidden**: Insufficient permissions
-   **404 Not Found**: Resource not found
-   **409 Conflict**: Duplicate resource (e.g., email exists)
-   **429 Too Many Requests**: Rate limit exceeded
-   **500 Internal Server Error**: Unexpected server error

#### Frontend Error Handling

-   Global error boundary for React errors
-   Toast notifications for user-facing errors
-   Form-level validation errors
-   Network error retry logic
-   Automatic token refresh on 401 (if using refresh tokens)

### Performance Considerations

#### Backend Optimization

-   Database connection pooling
-   Indexed database queries (email, provider IDs)
-   Rate limiting to prevent abuse
-   Compression middleware (gzip)
-   Request timeout configuration
-   Caching strategies for static data

#### Frontend Optimization

-   Server-side rendering for initial load
-   Code splitting with dynamic imports
-   Image optimization with Next.js Image
-   Font optimization (Geist fonts preloaded)
-   Minimize client-side JavaScript
-   Lazy load non-critical components
