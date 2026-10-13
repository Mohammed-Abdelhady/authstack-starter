# Facebook OAuth Permissions Guide

**App ID**: 2101845207256220
**Last Updated**: 2026-01-20

---

## Overview

This document explains the Facebook permissions required for OAuth authentication in the AuthStack Starter application.

---

## Required Permissions

### 1. `email` (Default Permission)

**Status**: ✅ **Default - No App Review Required**

**Purpose**: Access user's email address for account creation and identification

**What it provides**:

- User's primary email address from Facebook account
- Required for creating user accounts in the system
- Used for account recovery and notifications

**Backend usage**:

```typescript
// backend/src/auth/strategies/facebook-oauth.strategy.ts
const userInfo = await this.getUserInfo(accessToken);
console.log(userInfo.email); // "user@example.com"
```

**Important**: The app **REQUIRES** email to be present. If a Facebook user denies email permission or their account has no email, authentication will fail with error:

```
UnauthorizedException: No email found on Facebook account
```

**User sees**: "Access to your email address"

---

### 2. `public_profile` (Default Permission)

**Status**: ✅ **Default - No App Review Required**

**Purpose**: Access user's basic public profile information

**What it provides**:

- User's name (first name, last name, full name)
- Profile picture URL
- Facebook user ID
- Gender (optional)
- Locale (optional)

**Backend usage**:

```typescript
// backend/src/auth/strategies/facebook-oauth.strategy.ts
const userInfo = await this.getUserInfo(accessToken);
console.log(userInfo.name); // "John Doe"
console.log(userInfo.id); // "123456789"
console.log(userInfo.picture.data.url); // "https://platform-lookaside.fbsbx.com/..."
```

**Database fields populated**:

```javascript
{
  name: userInfo.name,           // From public_profile
  facebookId: userInfo.id,       // From public_profile
  picture: userInfo.picture.data.url  // From public_profile
}
```

**User sees**: "Access to your public profile"

---

## Permissions NOT Required

### ❌ `user_photos` (Advanced Permission)

**Status**: ❌ **NOT REQUESTED** - Would require App Review for Live mode

**Why NOT needed**:

- Profile picture URL is already available via `public_profile` permission
- `user_photos` grants access to **all user's photo albums**, not just profile picture
- App only needs profile picture, not photo albums
- Requesting unnecessary permissions violates Facebook's best practices

**What `user_photos` would provide** (if requested):

- Access to all photos uploaded by user
- Access to user's photo albums
- Photos user is tagged in

**Current implementation**:

```typescript
// backend/src/auth/strategies/facebook-oauth.strategy.ts
protected getScopes(): string[] {
  return ['email', 'public_profile'];  // ✅ Only default permissions
  // NOT requesting 'user_photos' ❌
}
```

---

## Scope Configuration in Backend

The Facebook OAuth strategy requests only the minimum required permissions:

```typescript
// backend/src/auth/strategies/facebook-oauth.strategy.ts

export class FacebookOAuthStrategy extends BaseOAuthStrategy {
  protected getScopes(): string[] {
    return [
      'email', // ✅ Required for account creation
      'public_profile', // ✅ Required for name and profile picture
    ];
  }
}
```

**Authorization URL generated**:

```
https://www.facebook.com/v18.0/dialog/oauth
  ?client_id=2101845207256220
  &redirect_uri=http://localhost:3000/auth/oauth/callback/facebook
  &scope=email,public_profile  ← Only these two scopes
  &response_type=code
  &state=random_state_token
```

---

## What Users See During OAuth

When a user clicks the Facebook OAuth button, they see:

```
┌─────────────────────────────────────────────────┐
│  AuthStack Starter                          │
│  wants to access your Facebook information      │
│                                                  │
│  ✓ Public profile                               │
│    Your name and profile picture                │
│                                                  │
│  ✓ Email address                                │
│    Your primary email address                   │
│                                                  │
│  [Cancel]  [Continue as John Doe]               │
└─────────────────────────────────────────────────┘
```

**What users can do**:

- ✅ Accept both permissions → Login succeeds
- ❌ Deny email permission → Login fails with clear error message
- ❌ Close popup → No action taken

---

## Facebook App Review Requirements

### Default Permissions (No Review Needed)

The following permissions are **automatically approved** and work in both Development and Live modes:

| Permission       | Review Required? | Status         |
| ---------------- | ---------------- | -------------- |
| `email`          | ❌ No            | ✅ Used by app |
| `public_profile` | ❌ No            | ✅ Used by app |

### Advanced Permissions (Would Require Review)

If we were to request advanced permissions (which we don't), App Review would be required:

| Permission           | Review Required? | Status           |
| -------------------- | ---------------- | ---------------- |
| `user_photos`        | ✅ Yes           | ❌ Not requested |
| `user_posts`         | ✅ Yes           | ❌ Not requested |
| `user_friends`       | ✅ Yes           | ❌ Not requested |
| `pages_manage_posts` | ✅ Yes           | ❌ Not requested |

**Our app only uses default permissions**, so **no App Review is required** for production deployment.

---

## Verifying Permissions in Facebook Developer Console

### Step 1: Navigate to App Review

1. Visit: https://developers.facebook.com/apps/2101845207256220/
2. In left sidebar, click: **App Review** → **Permissions and Features**

### Step 2: Check Default Permissions

You should see these permissions listed as **"Available"**:

```
✅ email
   Status: Available (Default)
   Description: Provides access to the person's primary email address

✅ public_profile
   Status: Available (Default)
   Description: Provides access to a person's public profile info
```

### Step 3: Verify No Advanced Permissions Requested

Under **"Pending Approval"** or **"Requested"**, there should be:

- ❌ NO advanced permissions listed
- ❌ NO pending review requests

---

## Permission Grant Flow

### What Happens When User Authorizes

1. **User clicks Facebook button** on login page
2. **Popup opens** with Facebook authorization page
3. **User logs in** to Facebook (if not already logged in)
4. **Facebook shows permission screen**:
   - "AuthStack Starter wants to access your public profile and email address"
5. **User clicks "Continue as [Name]"**
6. **Facebook redirects** to callback URL with authorization code
7. **Backend exchanges code** for access token
8. **Backend fetches user info** using Graph API:
   ```http
   GET https://graph.facebook.com/v18.0/me?fields=id,name,email,picture
   Authorization: Bearer {access_token}
   ```
9. **Backend receives user data**:
   ```json
   {
     "id": "123456789",
     "name": "John Doe",
     "email": "john.doe@example.com",
     "picture": {
       "data": {
         "url": "https://platform-lookaside.fbsbx.com/platform/profilepic/..."
       }
     }
   }
   ```
10. **Backend creates user** in MongoDB with Facebook profile data
11. **Backend issues session cookie** (HTTP-only, Secure, SameSite=Strict)
12. **Frontend redirects** to dashboard

---

## Permission Errors and Troubleshooting

### Error: "No email found on Facebook account"

**Cause**: User denied email permission OR Facebook account has no email

**Error in backend logs**:

```
UnauthorizedException: No email found on Facebook account
```

**Frontend shows**: "Failed to authenticate with Facebook"

**Solution**:

1. Ask user to grant email permission
2. Verify Facebook account has a verified email address
3. User can retry OAuth flow

---

### Error: "Invalid scope: user_photos"

**Cause**: Backend accidentally requests `user_photos` permission

**Fix**: Verify backend strategy only requests default permissions:

```typescript
// backend/src/auth/strategies/facebook-oauth.strategy.ts
protected getScopes(): string[] {
  return ['email', 'public_profile'];  // ✅ Correct
  // return ['email', 'public_profile', 'user_photos'];  // ❌ Wrong
}
```

---

## Profile Picture Access

### How Profile Pictures Work

**Profile pictures are accessible via `public_profile` permission**:

```typescript
// Graph API request
GET https://graph.facebook.com/v18.0/me?fields=id,name,email,picture

// Response includes picture URL
{
  "picture": {
    "data": {
      "height": 50,
      "width": 50,
      "is_silhouette": false,
      "url": "https://platform-lookaside.fbsbx.com/platform/profilepic/v1/123456789/640.jpg"
    }
  }
}
```

**Picture URL properties**:

- Hosted on Facebook's CDN
- Publicly accessible (no auth required once you have URL)
- Updates automatically if user changes profile picture
- Available in multiple sizes (default: 50x50, can request larger)

**Backend storage**:

```javascript
// Database stores URL, not the image file
{
  picture: 'https://platform-lookaside.fbsbx.com/platform/profilepic/...';
}
```

**Why we DON'T need `user_photos` permission**:

- ✅ Profile picture URL is in `public_profile` scope
- ❌ `user_photos` grants access to **all photo albums** (unnecessary)
- ✅ App only needs profile picture, not private photos

---

## Best Practices

### ✅ DO:

- Request only permissions actually needed (`email`, `public_profile`)
- Handle email denial gracefully with clear error messages
- Use default permissions when possible (avoids App Review)
- Store profile picture URL, not the image file
- Respect user privacy by minimizing data access

### ❌ DON'T:

- Request `user_photos` just to get profile picture
- Request advanced permissions without justification
- Store user data not needed by the application
- Bypass email requirement (email is critical for account management)
- Request permissions you won't use

---

## Production Checklist

Before deploying to production, verify:

- [ ] App only requests `email` and `public_profile` scopes
- [ ] Backend strategy does NOT include `user_photos` or other advanced permissions
- [ ] Error handling in place for missing email
- [ ] Facebook App is in **Live** mode (or users added as Testers for Development mode)
- [ ] Production redirect URI configured in Facebook App
- [ ] Privacy Policy URL added to Facebook App (required for Live mode)
- [ ] App icon uploaded (recommended for user trust)

---

## References

- [Facebook Login Permissions](https://developers.facebook.com/docs/facebook-login/permissions)
- [Graph API User Object](https://developers.facebook.com/docs/graph-api/reference/user/)
- [App Review Documentation](https://developers.facebook.com/docs/app-review)
- [Facebook Platform Policy](https://developers.facebook.com/policy/)

---

## Summary

**Permissions Used**: `email`, `public_profile` (both default, no review needed)
**Permissions NOT Used**: `user_photos`, `user_posts`, `user_friends`, etc.
**App Review Required**: ❌ No (only using default permissions)
**Profile Picture Access**: ✅ Yes (via `public_profile`, no need for `user_photos`)
**Email Required**: ✅ Yes (authentication fails if email not provided)

The app follows Facebook's best practices by requesting only the minimum permissions needed for OAuth authentication.
