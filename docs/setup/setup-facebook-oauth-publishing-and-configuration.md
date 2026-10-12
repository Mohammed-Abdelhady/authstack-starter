# Facebook OAuth publishing and advanced configuration

[Guide overview](setup-facebook-oauth.md)

### Publishing Steps

1. Navigate to **Settings** → **Basic**
2. Select **App Category**:
   - Business and Pages
   - Education
   - Entertainment
   - Finance
   - Utilities
   - Other
3. Switch **App Mode** from **Development** to **Live**
4. Confirm the change

**Warning**: Once live, all configuration changes require review.

---

## Troubleshooting

### Error: "URL Blocked: This redirect failed because the redirect URI is not whitelisted"

**Cause**: Redirect URI not added to OAuth settings.

**Solution**:

1. Go to **Facebook Login** → **Settings**
2. Add redirect URI to **Valid OAuth Redirect URIs**
3. Format: `http://localhost:3000/api/auth/oauth/callback`
4. Click **Save Changes**

### Error: "App Not Set Up: This app is still in development mode"

**Cause**: App is in Development mode and user is not a tester.

**Solution**:

1. Add user as test user (**Roles** → **Test Users**)
2. Or switch app to **Live** mode (production only)

### Error: "Invalid App ID"

**Cause**: App ID doesn't match or is incorrect.

**Solution**:

1. Copy App ID from **Settings** → **Basic**
2. Update `OAUTH_FACEBOOK_CLIENT_ID` in `backend/.env`
3. Restart servers

### Error: "Invalid OAuth access token"

**Cause**: Access token expired or invalid.

**Solution**:

1. Verify `OAUTH_FACEBOOK_CLIENT_SECRET` is correct
2. Check token hasn't expired (short-lived tokens expire in 1-2 hours)
3. Implement token refresh mechanism

### Error: "Missing required parameter: email"

**Cause**: User denied email permission or email not available.

**Solution**:

1. Check if `email` scope is requested
2. Handle cases where email is not provided
3. Some Facebook accounts don't have email addresses

---

## Security Best Practices

### Protect App Secret

- ✅ **Never expose in frontend code**
- ✅ Store in environment variables only
- ✅ Never commit to version control
- ✅ Reset if accidentally exposed

### Reset App Secret

If your secret is compromised:

1. Go to **Settings** → **Basic**
2. Click **Reset App Secret**
3. Confirm reset
4. Update `.env` files
5. Redeploy applications

### Validate Redirect URIs

- ✅ Whitelist exact redirect URIs
- ✅ Use HTTPS in production
- ✅ Enable **Use Strict Mode for Redirect URIs**

### Limit Permissions

- ✅ Request minimum necessary permissions
- ✅ Only request `public_profile` and `email` for basic auth
- ✅ Additional permissions require app review

### Token Security

- ✅ Use short-lived access tokens
- ✅ Implement token refresh
- ✅ Store tokens securely (httpOnly cookies)
- ✅ Invalidate tokens on logout

---

## Advanced Configuration

### Request Additional Fields

Request more profile fields:

```typescript
const fields = ['id', 'name', 'email', 'picture.width(200).height(200)'];
const graphUrl = `https://graph.facebook.com/me?fields=${fields.join(',')}&access_token=${accessToken}`;
```

### Long-Lived Access Tokens

Exchange short-lived token for long-lived (60 days):

```typescript
const url = new URL('https://graph.facebook.com/oauth/access_token');
url.searchParams.append('grant_type', 'fb_exchange_token');
url.searchParams.append('client_id', process.env.OAUTH_FACEBOOK_CLIENT_ID);
url.searchParams.append('client_secret', process.env.OAUTH_FACEBOOK_CLIENT_SECRET);
url.searchParams.append('fb_exchange_token', shortLivedToken);

const response = await fetch(url);
const data = await response.json();
const longLivedToken = data.access_token;
```

### Page Access Tokens

For managing Facebook Pages:

1. Request `manage_pages` permission (requires review)
2. Get page access tokens via Graph API
3. Use for posting, reading insights, etc.

### Webhooks

Receive real-time updates:

1. Navigate to **Webhooks** → **Page**
2. Add webhook URL: `https://yourdomain.com/api/webhooks/facebook`
3. Subscribe to events (feed, messages, etc.)
4. Implement verification endpoint

---

## Facebook Graph API

### Get User Info

```typescript
const response = await fetch(
  `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${accessToken}`,
);
const user = await response.json();
```

### Get Profile Picture

```typescript
const pictureUrl = `https://graph.facebook.com/${userId}/picture?width=200&height=200&access_token=${accessToken}`;
```

### Debug Access Token

Verify token validity:

```typescript
const debugUrl = `https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${appToken}`;
```

**App Token**: `{APP_ID}|{APP_SECRET}`

---

## Rate Limits

### API Rate Limits

- **Per app**: 200 calls per user per hour
- **Per user**: Varies by API endpoint
- **Page insights**: 4,800 calls per 24 hours

### Exceeding Limits

If you hit rate limits:

1. Implement exponential backoff
2. Cache responses when possible
3. Request rate limit increase via support

---

## Data Privacy Compliance

### GDPR Requirements

If serving EU users:

1. **Data Minimization**: Only request necessary permissions
2. **User Consent**: Clear opt-in for data collection
3. **Data Deletion**: Implement user data deletion
4. **Privacy Policy**: Detail data usage

### Data Deletion Callback

Implement endpoint to handle deletion requests:

```typescript
@Post('webhooks/facebook/data-deletion')
async handleDataDeletion(@Body() payload: FacebookDeletionPayload) {
  const userId = payload.user_id;

  // Delete user data from your database
  await this.userService.deleteByFacebookId(userId);

  return {
    url: `https://yourdomain.com/deletion-confirmation/${userId}`,
    confirmation_code: generateConfirmationCode(),
  };
}
```

Add callback URL in **Settings** → **Basic** → **User Data Deletion**.

---

## Migration from JavaScript SDK

If migrating from Facebook JavaScript SDK:

### Legacy Code (Client-Side OAuth)

```javascript
// Old: Client-side authentication
FB.login((response) => {
  const accessToken = response.authResponse.accessToken;
  // Send token to backend
});
```

### New Code (Server-Side OAuth)

```javascript
// New: Server-side OAuth flow
window.location.href = authorizationUrl;
```

**Benefits of Server-Side**:

- More secure (app secret never exposed)
- Better token management
- Easier to audit

---

## Monitoring & Analytics

### App Analytics

1. Navigate to **Analytics** → **Overview**
2. View metrics:
   - Active users
   - New users
   - Login attempts
   - API calls

### Facebook Business Manager Integration

Link to Business Manager for advanced features:

1. Create Business Manager account
2. Link app to business
3. Access ads, analytics, and insights

---

## Resources

- [Facebook Login Documentation](https://developers.facebook.com/docs/facebook-login)
- [Graph API Reference](https://developers.facebook.com/docs/graph-api)
- [Facebook Developer Community](https://developers.facebook.com/community/)
- [OAuth Best Practices](https://developers.facebook.com/docs/facebook-login/security/)

---

## Support

For Facebook OAuth issues:

- [Facebook Developer Support](https://developers.facebook.com/support/)
- [Stack Overflow](https://stackoverflow.com/questions/tagged/facebook-oauth)
- [Facebook Developers Community Forum](https://developers.facebook.com/community/)
