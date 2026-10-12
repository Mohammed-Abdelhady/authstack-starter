# Mobile sign-in options

## Intent

Both Expo and bare React Native apps should show the account's available sign-in methods on a native screen. Native email/password and passkeys work in the app. Provider buttons use suitable native SDKs, with secure system authorization sheets for the remaining providers. Continue in browser remains available.

## User choices

Use provider SDKs where available and system sheets for the rest. Preserve all configured methods. Apply this to both existing mobile shells through their shared packages.

## Proposed product behavior

- Discover enabled methods from the backend and intersect them with installed platform capabilities. Show a loading state and a retryable discovery failure. Hide disabled methods. Keep web sign-in available when method discovery fails, unless the server has explicitly disabled native sessions.
- Show the native email/password form when password login is enabled. Support password visibility, platform autofill, keyboard submission, inline validation and server errors. Clear the password after handing it to the first-factor request.
- Show native passkey sign-in when passkeys and the platform association are configured. Use the platform credential sheet and validate the assertion at the backend. Cancellation returns to the choice screen. An unavailable native ceremony offers web sign-in explicitly.
- Prefer Google SDK on iOS/Android, Apple SDK on iOS and Facebook SDK on supported platforms. Verify Facebook Limited Login separately from its Graph access-token mode. Apple on Android, Microsoft and other configured providers use the existing system authorization flow when a suitable React Native SDK is unavailable. Never hide a configured provider just because it has no native SDK.
- When an account owes a second step, show native authenticator-code, recovery-code and eligible passkey choices. Preserve the rule that a possession-only passkey cannot count as both factors. No account session exists before all required factors finish.
- Show the verified account and app grant before completing sign-in. Cancel ends the attempt. Finish through the existing PKCE code exchange and device-bound credential storage.
- Offer native email-link sign-in, registration with email verification and password recovery. The existing web journey stays available for each option. Account and device-management screens keep their current behavior.
- Translate all new labels, hints and failure states into English and Modern Standard Arabic. Keep Latin emails/codes and provider marks readable in both directions. Use a scrollable layout that remains usable above the keyboard and with larger text.

## Native email and account lifecycle

Email-link requests use the existing enabled-method, generic-address response and mail caps. The link is bound to the native attempt and its secret, has a single-use token, and returns to the exact registered app callback. The app saves only its pending attempt secret and PKCE state in secure storage so a cold start can resume. A link from another attempt/device cannot complete this app's attempt; explain this and offer to request a new link or use the existing web journey. Resending invalidates the earlier link. A link never skips MFA.

Registration asks for email, then the six-digit email verification code, name and password. Use the existing registration/activation limits, validation and duplicate-address behavior. Activation creates the account through the existing persistence workflow, then enters native consent/code exchange without writing a browser session. A failed final sign-in cannot pretend the account activation failed; offer sign-in to the account that was created.

Password recovery asks for email, then its six-digit recovery code and a new password. Preserve generic unknown-address replies, code lifetime/attempt limits, all-session invalidation and security notices. Confirm the persisted password update and return to native sign-in without silently issuing a session. Clear passwords and codes from UI state after their request finishes.

Browser alternatives remain available for these native flows. Disabled password or magic-link features hide the corresponding native entry points and reject requests after discovery if the setting changed.

## Implementation decisions

Reuse the backend password verifier, provider identity and account-linking rules, passkey signature/counter checks, second-factor verification and existing native authorization-code/token issuer. Extract shared validation where its existing browser completion is coupled to cookies. Direct native routes never copy browser cookies into bearer storage or trust client-supplied account identity.

Native attempts live in persistence with a short fixed expiry, client/redirect/scope/auth-epoch binding, S256 PKCE, server nonce and a device-proof binding where required. Completed factor state is held server-side. Each transition has one winner. Captured account/client/grant versions are checked again before code/token issuance. MFA and passkey challenges are bound to the same attempt and cannot be used by browser routes.

SDK artifacts are verified server-side for signature or provider introspection, trusted issuer/app audience, expiry and nonce where supported. Google uses a freshly requested ID token with the one-time server nonce digest. The SDK must use an interactive path; a cached token without this nonce is refused. The existing subject-first account policy owns creation/linking, including Facebook's restriction on automatic email linking. No fake provider completion is shipped.

Use react-native-passkeys through a shared typed platform adapter, subject to an actual SDK57 native build. Native passkeys require iOS associated domains and Android Digital Asset Links plus an explicit allowlist of native origins/app identities. Configuration uses public app/client identifiers and server-owned policies. Missing configuration leaves the working system web route available. Do not change the current RP ID or broaden the browser origin allowlist to make native assertions pass.

A new public JSON native-attempt start applies the existing registered-client, redirect, scope, auth-epoch and S256 validation. It returns an opaque attempt ID and a separate random bearer secret. Store only the secret hash. Require that secret on every native factor, consent and cancel request; do not expose the internal authorization transaction ID. API states are firstFactorRequired, secondFactorRequired, consentRequired, codeReady and denied. The consent response carries server-verified account/app details and actual grant state. Consent takes identity from the persisted factor state and calls the existing approval/code issuer. Token exchange remains authorization_code or refresh_token only.

The native attempt owns first-factor completion, MFA attempts and final consent. Consume a recovery code or passkey challenge and advance durable completed-factor state in one unit of work where they share database mutations. A later consent/approval failure leaves completed factors available for consent retry until expiry. A factor-validation or persistence failure cannot create a success state. Recheck captured account version and current MFA policy when completing; refuse attempts invalidated by credential/security changes. Browser challenge tokens and native attempts are distinct and cannot complete one another.

The SDK artifact matrix is Google ID-token JWT with nonce digest on both platforms; Apple identity-token JWT and one-use authorization code on iOS; Facebook Limited Login signed JWT with nonce on iOS; Facebook app-validated Graph access token on Android. Verify the Apple code with the configured native app audience and appropriate server credentials. Reuse the existing JWT verifier and provider identity policy. SDK mode is advertised only when its native audience/app configuration is valid. Microsoft and all remaining configured providers use system OAuth. Facebook's existing no-auto-link policy remains in effect.

Native passkey options carry a stored challenge bound to the attempt, its secret and purpose. Verification checks that exact challenge and the configured RP plus separately configured native app origins. Cancellation keeps a pre-authentication attempt usable for choosing another method, invalidating its old challenge. Native assertions never use the browser cookie endpoint.

System-sheet provider actions and any selected web journey use a fresh existing browser authorization transaction. Switching from a native attempt first cancels it and starts a new PKCE verifier/state. No half-authenticated native state or web cookie transfers between the two. Preserve the validated web continuation to the native authorization page.

The shared auth engine owns one active attempt, cancellation and disposal, deadlines, late responses, token writes and refresh. UI hooks own form state. Public method discovery uses an intentionally public client instead of widening authenticated bearer transport behavior.

Design read: a mobile sign-in screen for existing account holders, using the app's current quiet utility style. Reuse the existing buttons, notices, typography, spacing, colors and native alerts. Use provider-supplied sign-in controls or branding assets where required. References are the existing web/mobile sign-in surfaces and the current Google/Apple sign-in guidelines. Fix the web empty-method guard to recognize a passkey-only deployment, because the retained web fallback must work for that configuration.

## Verification

Cases cover success and cancellation for every mode; missing/disabled methods and discovery errors; offline and server errors; invalid credentials; unknown/deleted accounts; SDK issuer/audience/nonce failures; passkey RP/origin/signature/counter failures; MFA attempts/lockout and recovery-code reuse; account/client/grant changes; repeated taps, method changes, concurrent completion, disposal and late storage writes; consent cancellation; browser callback and cold restart; both databases; both shells and generated feature omissions; email-link warm/cold callbacks and resend invalidation; registration code expiry/duplicate addresses and activation followed by a failed sign-in; recovery code expiry/replay and all-session revocation.

Run lint, typecheck, unit/config suites, builds, real MongoDB/PostgreSQL API contracts, committed browser journeys and generated-project smoke. Build native iOS and inspect real native password/MFA/web flows, English/Arabic, keyboard and scrolling. Android and live SDK/passkey ceremonies are verified when the necessary platform and registered provider/domain configuration is available; report each unavailable check explicitly. Synthetic adapter/API contracts do not establish a successful live provider or hardware passkey ceremony.

## Boundaries

This adds native sign-in choices, email-link sign-in, registration/activation and password recovery, with web alternatives preserved. Account linking and passkey management are outside this change. It does not upgrade Expo/React Native, publish stores, change deployed provider registrations or invent live configuration. Platform SDK choice is conditional on current compatibility evidence; a package existing in a registry alone is insufficient.

## Sources

- https://www.rfc-editor.org/rfc/rfc8252
- https://developers.google.com/identity/branding-guidelines
- https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple
- Source reports in this directory pin the existing backend, SDK, generator and platform contracts.

## SDK selection evidence

Google uses react-native-nitro-google-signin 1.3.0 with a caller-supplied SHA-256 hex nonce and an interactive path. Apple uses the Expo57 first-party Apple authentication module. Facebook uses the documented native SDK wrapper with separate platform proof modes. Package pins and passkey bridge compatibility are verified in the platform report and actual native build before release.
