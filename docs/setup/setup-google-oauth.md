# Google OAuth Setup Guide

This guide explains how to set up Google OAuth for social authentication in your application.

## Overview

Google OAuth allows users to sign in with their Google account without creating a new password. The application implements OAuth 2.0 with PKCE (Proof Key for Code Exchange) for enhanced security.

**User Flow**:

1. User clicks "Sign in with Google"
2. Redirects to Google login
3. User authorizes the app
4. Google redirects back with authorization code
5. Backend exchanges code for user info
6. User is logged in

---

## Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **Select a project** → **New Project**
3. Enter project details:
   - **Project Name**: `AuthStack Starter` (or your app name)
   - **Organization**: (optional)
   - **Location**: (optional)
4. Click **Create**
5. Wait for project creation (takes a few seconds)

---

## Step 2: Configure OAuth Consent Screen

The consent screen is what users see when they authorize your app.

### 1. Navigate to Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select user type:
   - **Internal**: Only users in your Google Workspace
   - **External**: Any Google user (select this for public apps)
3. Click **Create**

### 2. Configure App Information

**App Information**:

- **App name**: `AuthStack Starter` (or your app name)
- **User support email**: Your support email
- **App logo**: (optional) Upload 120x120px logo

**App Domain**:

- **Application home page**: `https://yourdomain.com`
- **Application privacy policy link**: `https://yourdomain.com/privacy`
- **Application terms of service link**: `https://yourdomain.com/terms`

**Authorized domains**:

- Add your production domain: `yourdomain.com`
- For local development: `localhost` (automatically allowed)

**Developer contact information**:

- Enter your email address

Click **Save and Continue**.

### 3. Configure Scopes

Scopes define what data your app can access.

1. Click **Add or Remove Scopes**
2. Select these scopes:
   - `email`: User's email address
   - `profile`: User's basic profile info (name, picture)
   - `openid`: OpenID Connect authentication
3. Click **Update**
4. Click **Save and Continue**

### 4. Test Users (for External apps in development)

If your app is in "Testing" mode:

1. Click **Add Users**
2. Enter test user email addresses (max 100)
3. Click **Save and Continue**

**Note**: Only test users can sign in until you publish your app.

### 5. Review and Submit

1. Review your configuration
2. Click **Back to Dashboard**

---

## Step 3: Create OAuth 2.0 Credentials

1. Navigate to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Select application type:
   - **Application type**: Web application
   - **Name**: `AuthStack Starter Web Client`

### Configure Authorized Origins

**Authorized JavaScript origins**:

- Development: `http://localhost:3000`
- Production: `https://yourdomain.com`

### Configure Redirect URIs

**Authorized redirect URIs**:

- Development: `http://localhost:5000/api/auth/oauth/google/callback`
- Production: `https://yourdomain.com/api/auth/oauth/google/callback`

Match your backend API URL and port.

4. Click **Create**
5. Copy your credentials:
   - **Client ID**: Starts with `xxxxx.apps.googleusercontent.com`
   - **Client Secret**: Random string

---

## Step 4: Configure Environment Variables

### Backend Configuration

Add to `backend/.env`:

```bash
# Google OAuth Configuration
OAUTH_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
OAUTH_GOOGLE_CLIENT_SECRET=your-client-secret
OAUTH_GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/oauth/google/callback

# Production override
# OAUTH_GOOGLE_CALLBACK_URL=https://yourdomain.com/api/auth/oauth/google/callback
```

### Frontend Configuration

The frontend discovers enabled OAuth providers dynamically by querying `GET /api/auth/oauth/providers`. When `OAUTH_GOOGLE_CLIENT_ID` is set on the backend, the Google sign-in button appears automatically.

---

## Step 5: Test OAuth Flow

### Using the Application

1. Start the backend:

   ```bash
   cd backend
   pnpm run start:dev
   ```

2. Start the frontend:

   ```bash
   cd frontend
   pnpm run dev
   ```

3. Navigate to `http://localhost:3000/auth/login`.
4. Click **Sign in with Google**.
5. Authorize the application on the Google consent page.
6. The browser redirects to `http://localhost:5000/api/auth/oauth/google/callback`, sets your session cookie, and lands on the dashboard.

### Manual Testing

Open the start endpoint directly in your browser:

```
http://localhost:5000/api/auth/oauth/google/start?redirect=/dashboard
```

The browser receives an HTTP 302 redirect with the signed state cookie and loads the Google consent page.

---

## Step 6: Publish Your App (Production Only)

If your app is in "Testing" mode, publish it for public access:

1. Navigate to **OAuth consent screen**
2. Check app status
3. Click **Publish App**
4. Confirm submission

---

## Troubleshooting

### Error: "Redirect URI Mismatch"

The redirect URI configured in Google Cloud Console must match `OAUTH_GOOGLE_CALLBACK_URL` in `backend/.env`.

1. Verify redirect URI in Google Console includes protocol, port, and exact path: `http://localhost:5000/api/auth/oauth/google/callback`
2. Verify `OAUTH_GOOGLE_CALLBACK_URL` matches without trailing slashes.

### Error: "Access Blocked: This app's request is invalid"

**Cause**: OAuth consent screen not configured or app not published.

**Solution**:

1. Complete OAuth consent screen setup
2. Add test users (for Testing mode)
3. Or publish app (for production)

### Error: "Invalid Client ID"

**Cause**: Client ID doesn't match or is incorrect.

**Solution**:

1. Copy Client ID from Google Console (Credentials page)
2. Ensure it ends with `.apps.googleusercontent.com`
3. Update both backend and frontend `.env` files
4. Restart servers

### Error: "Unauthorized domain"

**Cause**: Domain not added to authorized domains list.

**Solution**:

1. Go to OAuth consent screen
2. Add domain to **Authorized domains**
3. Wait a few minutes for changes to propagate

### Error: "Access Denied"

**Cause**: User denied permission or app scope is too broad.

**Solution**:

1. Minimize requested scopes (only `email`, `profile`, `openid`)
2. Ensure consent screen is clear about data usage
3. User must click "Allow" on consent screen

---

## Security Best Practices

### Protect Client Secret

- ✅ **Never expose in frontend code**
- ✅ Store in environment variables only
- ✅ Never commit to version control
- ✅ Use different credentials for dev/prod

### Validate Redirect URIs

- ✅ Whitelist exact redirect URIs
- ✅ Never use wildcards in production
- ✅ Use HTTPS in production
- ✅ Validate state parameter to prevent CSRF

### Limit Scopes

- ✅ Request minimum necessary scopes
- ✅ Only request `email`, `profile`, `openid` for basic auth
- ✅ Additional scopes require verification

### Token Security

- ✅ Store access tokens securely (httpOnly cookies)
- ✅ Use short-lived access tokens
- ✅ Implement token refresh mechanism
- ✅ Invalidate tokens on logout

---

## Advanced Configuration

### Custom Login Hint

Pre-fill user's email on Google login page:

```typescript
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.append('login_hint', 'user@example.com');
```

## More sections

- [Advanced Google OAuth configuration](setup-google-oauth-advanced-configuration.md)
