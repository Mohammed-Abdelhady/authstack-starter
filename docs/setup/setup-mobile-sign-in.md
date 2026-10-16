# Mobile sign-in setup

Expo and bare React Native share the same native authentication engine and screens.
They support password, email links, signup, password recovery, passkeys and MFA.
Configured providers use their native SDK when available or a system authorization
sheet. Each journey also offers the web option.

## Register the application

Enable native sessions and register the exact client, callback and scopes through
`AUTH_NATIVE_ENABLED` and `AUTH_NATIVE_APPLICATIONS`. The shells use the scheme
in their `app.json` as the client ID. The default Expo callback is
`com.example.mobile://oauth/callback`.

The `signIn` object controls the methods allowed for each native application.
These settings also depend on the corresponding backend feature being enabled.
<!-- feature:native-cli:start -->

The bare shell's client ID and callback are defined in
`mobile/cli/src/constants.ts`; its defaults are `native-app` and
`mobilecli://auth/callback`. Register those values when using that shell.
<!-- feature:native-cli:end -->

```json
{
  "clientId": "com.example.mobile",
  "displayName": "Mobile Expo",
  "redirectUris": ["com.example.mobile://oauth/callback"],
  "allowedScopes": ["api"],
  "signIn": {
    "password": true,
    "emailLink": true,
    "registration": true,
    "recovery": true,
    "providers": [
      {
        "id": "google",
        "mode": "googleIdentityToken",
        "webClientId": "YOUR_WEB_CLIENT.apps.googleusercontent.com",
        "iosClientId": "YOUR_IOS_CLIENT.apps.googleusercontent.com"
      },
      {
        "id": "apple",
        "mode": "appleIdentityTokenAndCode",
        "appId": "com.example.mobileexpo"
      },
      { "id": "facebook", "mode": "facebook", "appId": "YOUR_FACEBOOK_APP_ID" }
    ]
  }
}
```

Replace the example identifiers with registered public identifiers. A custom
scheme requires the backend's explicit development custom-scheme policy.
Production deployments should use the project's validated HTTPS app-link setup.
Keep the registered callback and the engine's `redirectUri` identical.

Native relying party IDs have a limit of 160 UTF-16 units. Provider SDK client
and application IDs have a limit of 128. The backend rejects longer native
configuration values at startup. Application and provider labels are trimmed,
normalized and shortened for native screens without changing stored settings.

Expo reads `EXPO_PUBLIC_API_ORIGIN` at bundle time. Its Debug builds fall back
to `http://localhost:5001`; production builds require an explicit origin.
Physical devices need a reachable HTTPS API address.
<!-- feature:native-cli:start -->

The bare shell reads its development and production API origins from
`mobile/cli/src/constants.ts`. Replace the production placeholder before building
for release.
<!-- feature:native-cli:end -->

<!-- feature:oauth-core:start -->

## Native provider SDKs

| Provider                | iOS                                           | Android                          | Required native configuration                        |
| ----------------------- | --------------------------------------------- | -------------------------------- | ---------------------------------------------------- |
| Google                  | Fresh interactive ID token                    | Fresh interactive ID token       | Web client ID; iOS client ID and reversed URL scheme | <!-- feature:google -->   |
| Apple                   | Identity token and one-use authorization code | System OAuth                     | iOS bundle ID and Sign in with Apple capability      | <!-- feature:apple -->    |
| Facebook                | Limited Login authentication JWT              | App-validated Graph access token | Facebook app ID and public client token              | <!-- feature:facebook --> |
| Other enabled providers | System OAuth                                  | System OAuth                     | Existing backend provider configuration              |

<!-- feature:google:start -->

Google uses `react-native-nitro-google-signin`. Set
`MOBILE_GOOGLE_IOS_URL_SCHEME` to the reversed iOS client ID, such as
`com.googleusercontent.apps.YOUR_IOS_CLIENT`. Configure the Android package name
and signing certificate in the Google project. The backend verifies the token's
server audience and the nonce of the current attempt. A previously cached token
cannot complete a new attempt. See the [selected SDK's setup guide](https://github.com/react-native-nitro-google-sign-in/google-signin)
and the [backend Google setup](setup-google-oauth.md).
<!-- feature:google:end -->

<!-- feature:apple:start -->

Set `MOBILE_APPLE_SIGN_IN_ENABLED=true` for iOS and enable Sign in with Apple for
the registered bundle ID. The native `appId` is that bundle ID. The backend uses
its existing Apple credentials to exchange the code and checks that both tokens
refer to the same subject. Apple on Android uses the existing browser route.
See [Expo Apple authentication](https://docs.expo.dev/versions/latest/sdk/apple-authentication/)
and the [backend Apple setup](setup-apple-oauth.md).
<!-- feature:apple:end -->

<!-- feature:facebook:start -->

Set `MOBILE_FACEBOOK_APP_ID`, `MOBILE_FACEBOOK_CLIENT_TOKEN` and, optionally,
`MOBILE_FACEBOOK_DISPLAY_NAME`. The first two must be supplied together. The
native and backend app IDs must match. The client token is public; the app secret
belongs on the backend. The iOS wrapper initializes Facebook at app launch;
provider sign-in starts when the user selects it. The configured build plugin
sets the automatic event logging and advertising ID collection flags to false.
Facebook identities retain the existing restriction against automatic email
linking. See the [native wrapper configuration](https://github.com/thebergamo/react-native-fbsdk-next)
and the [backend Facebook setup](setup-facebook-oauth.md).
<!-- feature:facebook:end -->

Unconfigured or unavailable SDKs offer the provider's system OAuth option. All
other enabled providers are discovered from the backend and use system sheets.
No provider registration or production credential is created by the generator.
<!-- feature:oauth-core:end -->

<!-- feature:passkeys:start -->

## Passkeys

Set `signIn.passkeys=true`, `signIn.rpId` and `signIn.origins` on the registered
native application. An application without `signIn.rpId` and `signIn.origins`
makes no passkeys. The browser keeps its own relying party, `WEBAUTHN_RP_ID`.

```json
"signIn": {
  "passkeys": true,
  "rpId": "example.com",
  "origins": [
    "https://example.com",
    "android:apk-key-hash:YOUR_43_CHARACTER_BASE64URL_DIGEST"
  ]
}
```

### Relying party

`signIn.rpId` is a bare domain, with no scheme, port or path. It can be the same
as `WEBAUTHN_RP_ID` or a different domain. When it differs, passkeys made in the
app belong to the app's relying party and passkeys made in the browser belong to
the web one. Each is counted, offered at sign-in and removable only for its own
relying party. See [a relying party for the mobile app](setup-passkeys.md#a-relying-party-for-the-mobile-app).

Pick the relying party id once. Changing `signIn.rpId` orphans every passkey made
for the old value, and those people have to register again through another
sign-in method.

Set `MOBILE_PASSKEY_RP_ID` to the same value as `signIn.rpId`. The app refuses
registration options for any other relying party.

### iOS associated domain

The build plugin adds `webcredentials:` followed by `MOBILE_PASSKEY_RP_ID` to the
iOS associated domains. Serve the Apple association file on that domain, listing
the app's team and bundle identifier under `webcredentials`. Rebuild the app after
changing the domain.

### Android key hash origin

On Android, the app's ceremonies report the origin `android:apk-key-hash:`
followed by the SHA-256 digest of the app's signing certificate, encoded as
base64url without padding. That is 43 characters. Take the digest from the
certificate that signs the build you install: the debug and release certificates
give different values, and so does a Play App Signing key. Add each one you use
to `signIn.origins`. Serve Android Digital Asset Links on the relying party
domain for the same package and certificate.

### Origins match exactly

Every entry in `signIn.origins` is either an exact HTTPS origin with no path, or
an Android key hash origin. The backend refuses anything else at startup. At
registration and sign-in an origin is accepted only when it equals an entry.
A subdomain of the relying party, a sibling domain or another port does not
match. Do not add native identities to `WEBAUTHN_ORIGIN`.

### Making a passkey in the app

The engine's `passkeys.register()` asks the server for options, opens the system
prompt and sends the result to verify. It uses
`/api/auth/native/passkeys/register/options` and `/register/verify` with the
app's access token. See [register a passkey from the mobile app](setup-passkeys.md#register-a-passkey-from-the-mobile-app).

- The person must have signed in within the last five minutes. Otherwise the
  outcome is `signInAgain`: send them through sign-in, then call `register()`
  again.
- The app route always asks the authenticator to verify the user, and refuses a
  passkey made without it.
- The other outcomes are `created`, `cancelled`, `notSupported`,
  `alreadyRegistered` and `failed`. `passkeys.available()` says whether this
  device can make a passkey. Whether the account has one comes from
  `passkeys.list()`.

Listing, renaming and removing take the app's access token on the same routes
the browser uses. A mobile access token on the browser registration routes gets
`403 FORBIDDEN`.

### Not verified

- Android device builds: the Kotlin side of the passkey library and the key hash
  origin have been typechecked and unit tested only.
- A physical iPhone. The simulator covers the ceremony, not real secure hardware.
- On iOS, `react-native-passkeys` 0.4.2 reports an authenticator that already
  holds the account's passkey as an unknown error, so the outcome is `failed`
  rather than `alreadyRegistered`. Android reports it correctly.

See [passkey setup and enrollment](setup-passkeys.md) and the
[native passkey bridge](https://github.com/peterferguson/react-native-passkeys).
<!-- feature:passkeys:end -->

## App links

For HTTPS callbacks, set `MOBILE_APP_LINK_HOST` and optionally
`MOBILE_APP_LINK_PATH`, which defaults to `/oauth/callback`. The build adds the
iOS `applinks:` domain and Android verified-link intent filter. Configure the
domain association files and register the exact callback with the backend.
The engine configuration must use that same callback.

## Email and account journeys

The backend mail configuration and existing send limits apply to native journeys.
Method availability requires both the backend feature and the native application's
permission for that method.

- Email links return to the registered callback with the current attempt ID,
  email token and PKCE state. Open the link on the device that requested it.
  A cold start restores the saved attempt from secure storage. Resending replaces
  the previous token. Email-link completion still requires MFA when enabled.
- Emailed codes sign in with the six digits from the mail, and its button finishes the same attempt on the phone that asked. See [setup-email-code.md](setup-email-code.md). <!-- feature:email-code -->
- Signup requests a six-digit verification code, then asks for the code, name and
  password. The code is bound to the stored registration generation. Account
  activation can succeed even if the subsequent sign-in fails; the app reports
  that distinction and permits a new sign-in.
- Recovery requests a six-digit code and a new password. The persisted reset
  invalidates the account's sessions and returns to sign-in. Recovery does not
  silently create a new session.

The server stores hashes of attempt secrets and email proofs. The app stores only
the pending attempt and PKCE context in secure storage. Passwords, verification
codes and provider artifacts are not saved in engine snapshots or credential
records. The attempt expires after 15 minutes; resending does not extend it.

## Build and verify

Provider SDKs need a native development build. Use the repository's pinned
Expo and React Native versions, Node 22 and pnpm 12.6.0. Rebuild the native app
after changing provider settings, capabilities, callback schemes or associations.
The shared engine and adapter tests do not prove that a registered provider or
hardware passkey works on a physical device.

Before release, exercise each configured SDK on its target platforms, app-link
warm and cold returns, passkey enrollment and sign-in, MFA, email delivery,
signup, reset, cancellation and the retained web option. Check English and Arabic,
the keyboard and larger text. Release device-proof settings require hardware
protection; simulator Debug builds permit the project's software key.
