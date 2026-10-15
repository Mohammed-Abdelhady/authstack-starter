# API, constraints, and development workflow

[Guide overview](project.md)

### API Endpoints Specification

All API endpoints prefixed with `/api/`

#### Authentication Endpoints

```
POST   /api/auth/register
       Body: { email, password, name }
       Response: { message: "Registration email sent" }
       Status: 200 (success), 400 (validation error), 409 (email exists)

POST   /api/auth/activate
       Body: { token: "activation-jwt-token" }
       Response: { token: "jwt", user: {...} }
       Status: 200 (success), 400 (invalid/expired token)

POST   /api/auth/signin
       Body: { email, password }
       Response: { token: "jwt", user: {...} }
       Status: 200 (success), 401 (invalid credentials), 403 (not verified)

POST   /api/auth/forgot-password
       Body: { email }
       Response: { message: "Reset email sent" }
       Status: 200 (always - prevent email enumeration)

POST   /api/auth/reset-password
       Body: { token, newPassword }
       Response: { message: "Password updated" }
       Status: 200 (success), 400 (invalid/expired token)

POST   /api/auth/google
       Body: { idToken: "google-oauth-token" }
       Response: { token: "jwt", user: {...} }
       Status: 200 (success), 401 (invalid token)

POST   /api/auth/facebook
       Body: { accessToken: "fb-access-token" }
       Response: { token: "jwt", user: {...} }
       Status: 200 (success), 401 (invalid token)
```

#### User Endpoints (Protected)

```
GET    /api/user/profile
       Cookie: sid=<session>
       Response: { user: {...} }
       Status: 200 (success), 401 (unauthorized)

PUT    /api/user/profile
       Cookie: sid=<session>
       Body: { name, ... } (password excluded)
       Response: { user: {...} }
       Status: 200 (success), 401 (unauthorized), 400 (validation)

GET    /api/user/list (Admin only)
       Cookie: sid=<session>
       Query: ?page=1&limit=10
       Response: { users: [...], total, page, pages }
       Status: 200 (success), 401 (unauthorized), 403 (forbidden)
```

### Validation Rules

#### Password Requirements

-   Minimum length: 6 characters (from legacy - consider increasing to 8+)
-   Must contain: letters and numbers (strengthen in new implementation)
-   Maximum length: 128 characters
-   No common passwords (implement zxcvbn or similar)

#### Email Requirements

-   Valid email format (RFC 5322)
-   Maximum length: 255 characters
-   Normalized to lowercase
-   Unique in database

#### Name Requirements

-   Minimum length: 2 characters
-   Maximum length: 50 characters
-   Allow letters, spaces, hyphens, apostrophes
-   Trim whitespace

#### Session Configuration

-   **Cookie**: httpOnly `sid` (or `__Host-sid` in production)
-   **Lifetime**: 7 days (configurable via `SESSION_COOKIE_MAX_AGE`)
-   **Activation**: 6-digit email code, 15 minutes
-   **Password reset**: 6-digit email code, not a JWT

### Security Considerations

#### Authentication Security

-   Session cookies with `OAUTH_STATE_SECRET` (min 32 characters) for OAuth/passkey state
-   Password hashing with bcrypt (work factor ≥10)
-   Email verification required before activation
-   Rate limiting on authentication endpoints:
    -   Login: 5 attempts per 15 minutes per IP
    -   Registration: 3 attempts per hour per IP
    -   Password reset: 3 requests per hour per email
-   Account lockout after 5 failed login attempts (consider implementing)

#### Data Security

-   HTTPS only in production
-   httpOnly cookies for token storage (prevents XSS)
-   CORS configured with whitelist origins
-   Helmet middleware for security headers
-   Input sanitization to prevent XSS/injection
-   MongoDB parameterized queries (prevents NoSQL injection)

#### OAuth Security

-   Verify tokens with OAuth provider APIs
-   Store provider IDs (googleId, facebookId) securely
-   Allow account linking with existing email

#### Privacy & Compliance

-   Hash passwords before storage (never plain text)
-   No sensitive data in logs (passwords, tokens)
-   User data deletion capability (GDPR right to erasure)
-   Clear privacy policy and terms of service

## Important Constraints

### Technical Constraints

-   Must maintain backward compatibility with existing authentication features
-   Migration from Express/React to NestJS/Next.js should preserve all functionality
-   Database schema must remain compatible with existing MongoDB collections
-   API endpoints should follow RESTful conventions
-   Frontend must be responsive and mobile-friendly

### Business Constraints

-   Email delivery reliability (SendGrid integration)
-   OAuth provider requirements (Google, Facebook)
-   Password security standards (minimum length, complexity)
-   Session management and token expiration

### Regulatory Constraints

-   GDPR compliance for user data
-   Secure storage of user credentials
-   Privacy policy compliance

## External Dependencies

### Backend Services (To be Integrated)

-   **SendGrid**: Email service for verification and password reset emails
-   **MongoDB**: NoSQL database for user data
-   **Google OAuth**: Google authentication provider
-   **Facebook OAuth**: Facebook authentication provider

### Frontend Services (To be Integrated)

-   **Google OAuth Client**: React Google Login library
-   **Facebook OAuth Client**: React Facebook Login library
-   **Axios**: HTTP client for API communication

### Development Tools

-   **NestJS CLI**: Project scaffolding and code generation
-   **Next.js CLI**: Development server and build tools
-   **TypeScript Compiler**: Type checking and compilation
-   **ESLint & Prettier**: Code quality and formatting

### Package Managers

-   **pnpm 12.6.0**: Node.js package manager
-   **Node.js**: Runtime environment (version 18+ recommended, 20 LTS preferred)

## Development Workflow

### Local Development Setup

1. **Prerequisites**:
   -   Node.js 18+ installed
   -   MongoDB 6+ running locally or accessible
   -   SendGrid API key (for email features)
   -   Google/Facebook OAuth credentials (for social auth)

2. **Backend Setup**:
   ```bash
   cd backend
   pnpm install --frozen-lockfile
   cp .env.example .env  # Configure environment variables
   pnpm run start:dev      # Start with hot reload
   ```

3. **Frontend Setup**:
   ```bash
   cd frontend
   pnpm install --frozen-lockfile
   cp .env.local.example .env.local  # Configure environment
   pnpm run dev            # Start Next.js dev server
   ```

4. **Database Setup**:
   ```bash
   # Start MongoDB (if using Docker)
   docker run -d -p 27017:27017 --name mongodb mongo:latest

   # Or use MongoDB Compass for GUI management
   ```

### Development Best Practices

#### Code Organization

-   **Single Responsibility**: Each module/component has one clear purpose
-   **DRY Principle**: Extract reusable logic into utilities/hooks
-   **Dependency Direction**: Services depend on interfaces, not concrete implementations
-   **Feature-First**: Organize by feature/domain, not by technical layer
-   **No God Objects**: Break large classes/components into smaller pieces

#### Before Committing

1. Run linter: `pnpm run lint` (both frontend and backend)
2. Run tests: `pnpm test` (backend)
3. Format code: `pnpm run format` (backend)
4. Verify build: `pnpm run build` (both)
5. Check TypeScript: `tsc --noEmit` (verify no type errors)

#### Code Review Checklist

-   [ ] No sensitive data (API keys, passwords) in code
-   [ ] TypeScript strict mode passes (no `any` types)
-   [ ] Changed critical behavior has a focused test, with existing coverage reused where possible
-   [ ] Error handling implemented
-   [ ] Input validation on all endpoints/forms
-   [ ] Documentation updated (if API changes)
-   [ ] No console.log statements (use proper logging)
-   [ ] Migration scripts for database changes (if applicable)

## Deployment Considerations

### Production Environment Variables

Ensure all secrets are properly configured:

-   Use a strong `OAUTH_STATE_SECRET` (min 32 characters, random)
-   Configure MONGO_URI with authentication
-   Set NODE_ENV=production
-   Configure CLIENT_URL with production domain
-   Enable HTTPS/SSL certificates
-   Set secure CORS origins

### Backend Deployment

-   Build: `pnpm run build`
-   Start: `pnpm run start:prod`
-   Process manager: PM2 or similar
-   Health check endpoint: `/api/health`
-   Graceful shutdown handling
-   Log aggregation (Winston, Pino)

### Frontend Deployment

-   Build: `pnpm run build`
-   Deploy to Vercel (recommended) or other platforms
-   Environment variables configured in platform
-   CDN for static assets
-   Image optimization enabled

### Database Deployment

-   MongoDB Atlas (recommended) or self-hosted
-   Enable authentication
-   Configure connection pooling
-   Regular backups scheduled
-   Monitoring and alerts

### Security Checklist for Production

-   [ ] HTTPS enabled (SSL/TLS certificates)
-   [ ] Environment variables secured (not in code)
-   [ ] CORS configured with specific origins (not *)
-   [ ] Rate limiting enabled
-   [ ] Helmet middleware configured
-   [ ] MongoDB authentication enabled
-   [ ] Database backups automated
-   [ ] Secrets rotated regularly
-   [ ] Security headers configured
-   [ ] Input sanitization on all endpoints
-   [ ] SQL/NoSQL injection prevention
-   [ ] XSS protection enabled
-   [ ] CSRF tokens for state-changing operations

## Monitoring and Logging
