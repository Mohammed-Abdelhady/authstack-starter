# Logging, testing, and troubleshooting

[Guide overview](project.md)

### Logging Strategy

-   **Backend**: Use Winston or Pino for structured logging
-   **Log Levels**: error, warn, info, debug
-   **Never Log**:
    -   Passwords (plain or hashed)
    -   Session cookies
    -   API keys
    -   Sensitive user data (SSN, credit cards)
-   **Always Log**:
    -   Authentication attempts (success/failure)
    -   Authorization failures
    -   Rate limit hits
    -   Error stack traces (in dev only)
    -   Performance metrics

### Monitoring Metrics

-   API response times
-   Error rates by endpoint
-   Authentication success/failure rates
-   Database query performance
-   Memory and CPU usage
-   Active user sessions

### Health Checks

```typescript
// Backend health check endpoint
GET /api/health
Response: {
  status: 'ok',
  uptime: 12345,
  database: 'connected',
  memory: { ... },
  timestamp: '2024-01-16T...'
}
```

## Testing policy

Keep only tests that catch a concrete failure with material impact on account
access, security, persisted data, or generating and starting a working project.
This policy overrides generic requirements to test every change. Coverage
percentages and test counts are not acceptance criteria.

### What earns a test

| Risk | Coverage to retain |
| --- | --- |
| Account access | Sign-in success and refusal, registration and verification, recovery, enabled sign-in methods |
| Unauthorized access | Permission enforcement, privilege ceilings, cross-account isolation, protected routes |
| Credential and session misuse | Expiry, revocation, replay rejection, account switching, stale in-flight responses |
| Lost or unsafe writes | Destructive actions, persisted security settings, atomicity and meaningful race or outage failures |
| Broken generated projects | Safe scaffolding, supported database and client startup, required runtime contracts |

Retain unique regressions in these areas even when the happy path already has
coverage. A security-sensitive name alone does not justify a test. Its assertions
must detect the material failure.

### Choose the smallest useful layer

- Unit tests cover important decisions, parsers, and state transitions.
- Integration and contract tests prove real persistence, authorization, and
  producer/consumer behavior. Assert the stored result or observable response.
- E2E tests cover essential account and administration journeys that require the
  running application. Keep success and meaningful refusal or recovery paths.
  Add a browser, viewport, locale, or option combination only when it catches a
  distinct material failure.

Keep tests at multiple layers only when each catches a different failure. Extend
an existing behavioral test before creating another file. During development,
run the retained tests affected by the change. Before a PR, run lint, typecheck,
the retained suite, and build. Run API and browser journeys when their flows
change, and report unavailable checks accurately.

### What to remove or avoid

- Copy, translation wording, styling, snapshots, DOM structure, and routine
  rendering assertions.
- Trivial getters, forwarding, component wiring, or framework behavior already
  covered by the framework or an existing behavioral test.
- Duplicate happy paths and exhaustive presentation or option matrices without
  a distinct material risk.
- Tests added only to raise a coverage percentage or satisfy a file-count rule.

Routine documentation, presentation, and refactoring edits do not automatically
need new tests. Remove redundant tests after reading their assertions and
checking what retained coverage proves. Do not hide tests with exclusions or
skips, retry failures into green, lower thresholds, or weaken critical assertions.
Keep fixtures deterministic and isolated. Mock external services, and use real
persistence for database behavior.

## Common Development Scenarios

### Adding a New Protected Route

1. **Backend**: Create endpoint behind the global session AuthGuard
2. **Frontend**: Create page in `app/(protected)/` directory
3. **Middleware**: Add route protection logic if needed
4. **Tests**: Reuse permission and protected-route coverage. Add a focused case only for a new access-control risk.

### Adding a New Authentication Method

1. Create change proposal in `openspec/changes/`
2. Add a provider strategy in `auth/oauth/strategies/` (or a passwordless module)
3. Add controller endpoint in `auth.controller.ts`
4. Update AuthService with new method
5. Add DTO for validation
6. Update frontend with new auth button
7. Cover successful sign-in and material refusal or replay failures at the cheapest useful layer. Add browser coverage only for a new essential journey.

### Modifying User Schema

1. Create migration script in `migrations/`
2. Update Mongoose schema in `user.schema.ts`
3. Update DTOs if needed
4. Run migration on development database
5. Test thoroughly before production
6. Document breaking changes

## Troubleshooting Common Issues

### Backend Issues

**Issue**: Cannot connect to MongoDB
-   Check MONGO_URI in .env
-   Verify MongoDB is running
-   Check network connectivity

**Issue**: Session validation fails
-   Verify the `sid` cookie is sent (`credentials: 'include'`)
-   Check session expiry
-   Confirm the cookie was issued on the same origin/path

**Issue**: Email not sending
-   Verify MAIL_KEY (SendGrid API key)
-   Check SendGrid dashboard for errors
-   Verify EMAIL_FROM is verified in SendGrid

### Frontend Issues

**Issue**: CORS errors
-   Configure CLIENT_URL in backend .env
-   Add CORS origin in NestJS configuration
-   Check protocol (http vs https)

**Issue**: Authentication not persisting
-   Check the session cookie (`sid`) and `credentials: 'include'`
-   Verify AuthProvider / AuthGuard wrap protected routes
-   Confirm `getCurrentUser` succeeds before treating `isAuthenticated` as truth

**Issue**: Next.js hydration errors
-   Ensure server and client render same content
-   Check for browser-only APIs in server components
-   Use `"use client"` directive when needed

## Migration Notes

### From Legacy to Modern Stack

-   **Backend**: Express.js → NestJS with TypeScript
-   **Frontend**: React 16 with CRA → Next.js 16 with App Router
-   **Styling**: Tailwind CSS → Tailwind CSS 4.x
-   **Build Tools**: Webpack → Next.js built-in bundler
-   **Testing**: Jest → Jest with improved configuration

### Features to Migrate

1. User registration with email verification
2. Email/password login
3. Google OAuth integration
4. Facebook OAuth integration
5. Forgot password functionality
6. Reset password functionality
7. Protected routes and authentication guards
8. Admin dashboard
9. User management (admin only)
10. Toast notifications for user feedback

### Database Schema (From Legacy)

#### Users Collection

```typescript
{
  _id: ObjectId,                    // Auto-generated MongoDB ID
  email: string,                    // Unique, required, indexed, lowercase
  password?: string,                // Hashed with bcrypt (optional for OAuth-only users)
  name: string,                     // Required, 2-50 characters
  role: 'user' | 'admin',          // Default: 'user'
  isVerified: boolean,              // Email verification status, default: false
  linkedAccounts: { provider, providerId, linkedAt }[],
  primaryProvider?: string,
  resetPasswordExpires?: Date,      // Expiration for reset token
  googleId?: string,                // Google OAuth ID (indexed)
  facebookId?: string,              // Facebook OAuth ID (indexed)
  createdAt: Date,                  // Auto-generated timestamp
  updatedAt: Date                   // Auto-updated timestamp
}
```

#### Indexes

```javascript
// Ensure these indexes for performance and uniqueness
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ googleId: 1 }, { sparse: true });
db.users.createIndex({ facebookId: 1 }, { sparse: true });
db.users.createIndex({ createdAt: -1 });
```
