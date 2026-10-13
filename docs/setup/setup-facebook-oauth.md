# Facebook OAuth Setup Guide

This guide explains how to set up Facebook Login for social authentication in your application.

## 📚 Related Documentation

- **Permissions Guide**: See `docs/setup/facebook-oauth-permissions.md` for detailed information about:
  - What permissions the app requests (`email`, `public_profile`)
  - Why profile pictures DON'T require `user_photos` permission
  - App Review requirements (spoiler: none needed for basic login)
  - What users see during OAuth authorization

## Overview

Facebook Login allows users to sign in with their Facebook account. The application implements OAuth 2.0 for secure authentication.

**User Flow**:

1. User clicks "Sign in with Facebook"
2. Redirects to Facebook login
3. User authorizes the app
4. Facebook redirects back with authorization code
5. Backend exchanges code for access token and user info
6. An account with this Facebook identity already linked is logged in

Facebook does not give this application a reliable proof that the returned email address belongs to the person signing in. A new Facebook identity cannot create an account or attach itself by matching an address. First create and sign in to an account through another configured method, then link Facebook in account settings. An identity linked before this policy continues to sign in. A fresh database with Facebook as its only method has no first-account path.

---

## Step 1: Create Facebook Developer Account

1. Go to [Facebook for Developers](https://developers.facebook.com/)
2. Click **Get Started** (top right)
3. Log in with your Facebook account
4. Complete registration:
   - Accept Facebook Platform Terms
   - Verify email if needed
5. You'll be redirected to the dashboard

---

## Step 2: Create Facebook App

1. Click **My Apps** → **Create App**
2. Select use case:
   - **Use case**: Other
   - Click **Next**
3. Select app type:
   - **App type**: Consumer
   - Click **Next**
4. Enter app details:
   - **App name**: `AuthStack Starter` (or your app name)
   - **App contact email**: Your support email
   - **Business account**: (optional) Select if you have one
5. Click **Create App**
6. Complete security check (CAPTCHA)
7. You'll be redirected to app dashboard

---

## Step 3: Configure Facebook Login

### 1. Add Facebook Login Product

1. In app dashboard, find **Add a Product** section
2. Locate **Facebook Login**
3. Click **Set Up**
4. Select platform:
   - **Web** (for web applications)
5. Click **Next**

### 2. Configure Site URL

1. Enter your site URL:
   - Development: `http://localhost:3000`
   - Production: `https://yourdomain.com`
2. Click **Save**
3. Click **Continue**

### 3. Configure OAuth Settings

1. Navigate to **Facebook Login** → **Settings** (left sidebar)
2. Configure OAuth redirect URIs:

**Valid OAuth Redirect URIs**:

```
http://localhost:5000/api/auth/oauth/facebook/callback
https://yourdomain.com/api/auth/oauth/facebook/callback
```

**Important**:

- The callback URL must match `/api/auth/oauth/facebook/callback`
- Add both development and production URLs
- Must match exactly with backend `.env` configuration

3. Configure other settings:
   - **Login with the JavaScript SDK**: No (we use backend OAuth)
   - **Use Strict Mode for Redirect URIs**: Yes (recommended)
   - **Enforce HTTPS**: Yes (production only)
4. Click **Save Changes**

---

## Step 4: Configure App Settings

### 1. Basic Settings

1. Navigate to **Settings** → **Basic** (left sidebar)
2. Note your credentials:
   - **App ID**: Your application ID (numeric)
   - **App Secret**: Click **Show** to reveal (keep secure!)
3. Configure app details:
   - **App Domains**: Add your domain(s):
     ```
     localhost
     yourdomain.com
     ```
   - **Privacy Policy URL**: `https://yourdomain.com/privacy`
   - **Terms of Service URL**: `https://yourdomain.com/terms`
   - **User Data Deletion**: Callback URL or instructions
4. Click **Save Changes**

### 2. App Icon (Optional but Recommended)

1. Scroll to **App Icon**
2. Upload 1024x1024px icon
3. This appears on Facebook login dialog

---

## Step 5: Verify Permissions Configuration

The app requests only default permissions that **DO NOT require App Review**.

### Required Permissions (Default - No Review Needed)

| Permission       | What It Provides                   | Used For                                     |
| ---------------- | ---------------------------------- | -------------------------------------------- |
| `email`          | User's email address               | Profile data; not proof of address ownership |
| `public_profile` | Name, profile picture, Facebook ID | User profile sync                            |

**Important Notes**:

- ✅ These are **default permissions** - automatically available when you add "Facebook Login" product
- ✅ **Profile pictures** are included in `public_profile` permission
- ❌ **NO need** for `user_photos` permission (that's for photo albums, not profile pictures)
- ✅ No Facebook App Review required for basic login

### Verify Permissions Are Active

1. Navigate to **App Review** → **Permissions and Features**
2. You should see:
   - ✅ **email** - Status: Available (Default)
   - ✅ **public_profile** - Status: Available (Default)
3. No action needed - these are automatically approved

### What Users See During Login

When users click "Sign in with Facebook", they see:

```
"AuthStack Starter wants to access your Facebook information"

✓ Public profile (Your name and profile picture)
✓ Email address (Your primary email address)

[Cancel]  [Continue as John Doe]
```

### Advanced Permissions (NOT Used by This App)

The following permissions are **NOT requested** by the app:

- ❌ `user_photos` - Access to user's photo albums (not needed, profile picture is in `public_profile`)
- ❌ `user_birthday` - User's birthday
- ❌ `user_gender` - User's gender
- ❌ `user_location` - User's location
- ❌ `user_friends` - User's friends list

**Note**: Advanced permissions would require Facebook App Review before going live.

**For detailed information about permissions**, see: `docs/setup/facebook-oauth-permissions.md`

---

## Step 6: Configure Environment Variables

### Backend Configuration

Add to `backend/.env`:

```bash
# Facebook OAuth Configuration
OAUTH_FACEBOOK_CLIENT_ID=your-app-id-here
OAUTH_FACEBOOK_CLIENT_SECRET=your-app-secret-here
OAUTH_FACEBOOK_CALLBACK_URL=http://localhost:5000/api/auth/oauth/facebook/callback

# Production override
# OAUTH_FACEBOOK_CALLBACK_URL=https://yourdomain.com/api/auth/oauth/facebook/callback
```

**Important**:

- Use `OAUTH_FACEBOOK_CLIENT_ID` (not `FACEBOOK_APP_ID`)
- Callback URL must match `/api/auth/oauth/facebook/callback`
- Must match exactly with Facebook Developer Console redirect URI
- App Secret must never be committed to version control

### Frontend Configuration

**No frontend environment variables needed!**

The frontend automatically detects enabled OAuth providers by calling:

```
GET /api/auth/oauth/providers
```

When Facebook is configured in backend, the Facebook button appears automatically.

---

## Step 7: Test Facebook Login

### Switch to Development Mode

Before testing, ensure your app is in Development mode:

1. Toggle **App Mode** to **Development** (top of dashboard)
2. In Development mode:
   - Only app developers and testers can use Facebook Login
   - No public users can authenticate

### Add Test Users

1. Navigate to **Roles** → **Test Users**
2. Click **Add Test User**
3. Create test accounts
4. You can log in with these accounts for testing

### Manual Testing

1. Start your backend:

   ```bash
   cd backend
   pnpm run start:dev
   ```

2. Start your frontend:

   ```bash
   cd frontend
   pnpm run dev
   ```

3. Navigate to: `http://localhost:3000/auth/login`

4. Click **Sign in with Facebook** button

5. Log in with a test user or developer account

6. Authorize the application

7. If the Facebook identity was already linked, you should be redirected back and logged in. Otherwise, sign in another way and link it in account settings before retrying.

### Manual Testing

Open the start endpoint directly in your browser:

```
http://localhost:5000/api/auth/oauth/facebook/start?redirect=/dashboard
```

The browser receives an HTTP 302 redirect with the signed state cookie and loads Facebook's login dialog.

---

## Step 8: Go Live (Production)

Once testing is complete, publish your app:

### Prerequisites

1. **Privacy Policy**: Must be publicly accessible
2. **Data Deletion**: Implement user data deletion callback or instructions
3. **App Icon**: 1024x1024px icon uploaded
4. **App Category**: Select appropriate category
5. **Business Verification**: May be required for certain permissions

## More sections

- [Publishing and advanced configuration](setup-facebook-oauth-publishing-and-configuration.md)
