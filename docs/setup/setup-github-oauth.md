# GitHub OAuth Setup Guide

This guide explains how to set up GitHub OAuth for social authentication in your application.

## Overview

GitHub OAuth allows users to sign in with their GitHub account. This is particularly useful for developer-focused applications.

**User Flow**:

1. User clicks "Sign in with GitHub"
2. Redirects to GitHub authorization page
3. User authorizes the app
4. GitHub redirects back with authorization code
5. Backend exchanges code for access token and user info
6. User is logged in

---

## Step 1: Register GitHub OAuth App

1. Log in to [GitHub](https://github.com/)
2. Click your **profile picture** (top right) → **Settings**
3. Scroll to **Developer settings** (bottom of left sidebar)
4. Click **OAuth Apps** → **New OAuth App**

---

## Step 2: Configure OAuth Application

Fill in the application details:

### Application Information

**Application name**: `AuthStack Starter` (or your app name)

- This appears on the authorization screen
- Users will see "Authorize [Application name]"

**Homepage URL**:

- Development: `http://localhost:3000`
- Production: `https://yourdomain.com`

**Application description**: (optional)

```
Secure authentication system with email verification and social login.
```

- Brief description shown to users
- Max 400 characters

**Authorization callback URL**:

- Development: `http://localhost:5000/api/auth/oauth/github/callback`
- Production: `https://yourdomain.com/api/auth/oauth/github/callback`

**Important**:

- URL must match exactly (including protocol and port)
- You can only add ONE callback URL per OAuth app
- For multiple environments, create separate apps

### Register the Application

Click **Register application**.

---

## Step 3: Get Client Credentials

After registration, you'll see your app's credentials:

### Client ID

- Publicly visible identifier
- Format: `Iv1.1234567890abcdef`
- Safe to use in frontend code

### Client Secret

1. Click **Generate a new client secret**
2. Copy the secret immediately (you won't see it again)
3. Store securely in environment variables

**Warning**:

- Never commit client secret to version control
- Never expose in frontend code
- Reset if accidentally exposed

---

## Step 4: Configure Environment Variables

### Backend Configuration

Add to `backend/.env`:

```bash
# GitHub OAuth Configuration
OAUTH_GITHUB_CLIENT_ID=Iv1.1234567890abcdef
OAUTH_GITHUB_CLIENT_SECRET=your-client-secret-here
OAUTH_GITHUB_CALLBACK_URL=http://localhost:5000/api/auth/oauth/github/callback

# Production override
# OAUTH_GITHUB_CALLBACK_URL=https://yourdomain.com/api/auth/oauth/github/callback
```

### Frontend Configuration

The frontend discovers enabled OAuth providers by querying `GET /api/auth/oauth/providers`. When `OAUTH_GITHUB_CLIENT_ID` is present on the backend, the GitHub sign-in button appears automatically.

---

## Step 5: Test GitHub OAuth

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
4. Click **Sign in with GitHub**.
5. Authorize the application on GitHub.
6. The browser redirects to `http://localhost:5000/api/auth/oauth/github/callback`, sets your session cookie, and returns to the dashboard.

### Manual Testing

Open the start endpoint directly in your browser:

```
http://localhost:5000/api/auth/oauth/github/start?redirect=/dashboard
```

The browser receives an HTTP 302 redirect with the signed state cookie and loads GitHub's authorization page.

### Test with GitHub's OAuth Tool

GitHub provides a test page:

1. Go to your OAuth app settings
2. Find **Authorization callback URL**
3. Click the URL to test the flow

---

## Step 6: Request User Permissions (Scopes)

By default, GitHub only grants access to public user data.

### Available Scopes

**User Data**:

- `user`: Read/write access to profile info
- `user:email`: Access user email addresses (including private)
- `user:follow`: Follow/unfollow users

**Repository Access**:

- `repo`: Full control of private repositories
- `public_repo`: Access public repositories
- `repo:status`: Access commit status

**Organization Access**:

- `read:org`: Read org membership
- `write:org`: Manage org membership
- `admin:org`: Full org access

### For Basic Authentication

Only request these scopes:

```typescript
const scopes = ['user:email', 'read:user'];
```

This provides:

- User's email addresses (including private)
- Basic profile information (name, avatar, bio)

### Requesting Scopes

In your authorization URL:

```typescript
const authUrl = new URL('https://github.com/login/oauth/authorize');
authUrl.searchParams.append('client_id', process.env.OAUTH_GITHUB_CLIENT_ID);
authUrl.searchParams.append('redirect_uri', process.env.OAUTH_GITHUB_CALLBACK_URL);
authUrl.searchParams.append('scope', 'user:email read:user');
authUrl.searchParams.append('state', stateToken);
```

---

## Step 7: Handle Private Emails

Some GitHub users hide their email addresses.

### Primary Email vs Private Email

GitHub users can:

- Make email private
- Use `noreply` email for commits
- Have multiple verified emails

### Get All User Emails

Request `user:email` scope and fetch emails:

```typescript
const response = await fetch('https://api.github.com/user/emails', {
  headers: {
    Authorization: `token ${accessToken}`,
    Accept: 'application/vnd.github.v3+json',
  },
});

const emails = await response.json();
// Returns array of email objects
```

Response:

```json
[
  {
    "email": "user@example.com",
    "primary": true,
    "verified": true,
    "visibility": "public"
  },
  {
    "email": "12345678+user@users.noreply.github.com",
    "primary": false,
    "verified": true,
    "visibility": null
  }
]
```

### Get Primary Email

```typescript
const primaryEmail = emails.find((e) => e.primary && e.verified);
if (!primaryEmail) {
  throw new Error('No verified primary email found');
}
```

---

## Troubleshooting

### Error: "The redirect_uri MUST match the registered callback URL"

**Cause**: Callback URL doesn't match exactly.

**Solution**:

1. Check `OAUTH_GITHUB_CALLBACK_URL` in `backend/.env`
2. Verify it matches OAuth app settings exactly
3. Include protocol (`http://` or `https://`)
4. Include port (`:5000`)
5. No trailing slashes

Example:

- Correct: `http://localhost:5000/api/auth/oauth/github/callback`
- Wrong: `http://localhost:5000/api/auth/oauth/github/callback/`
- Wrong: `localhost:5000/api/auth/oauth/github/callback`

### Error: "Bad verification code"

**Cause**: Authorization code expired or already used.

**Solution**:

- Codes expire after 10 minutes
- Codes can only be used once
- User must re-authorize to get new code

## More sections

- [Troubleshooting and security](setup-github-oauth-troubleshooting.md)
- [OAuth app options and monitoring](setup-github-oauth-app-options.md)
