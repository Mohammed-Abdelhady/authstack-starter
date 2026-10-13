# Native mobile authentication implementation plan

Implement each task with focused cases and an independent review before integration.

**Goal:** Offer native password, provider SDK, passkey, email-link, registration, verification and recovery flows in both mobile shells, with web alternatives retained.

**Architecture:** A persisted native attempt owns factor state and consent. All successful sign-ins enter the existing PKCE, DPoP and credential lifecycle. Shared mobile packages own state and UI; shell adapters own SDK calls.

**Tech stack:** Node 22.23.3, pnpm 12.6.0, current Nest/MongoDB/PostgreSQL, Expo 57.0.26, React 19.2.3 and React Native 0.86.3. Google Nitro 1.3.0, Expo Apple 57.0.2, Facebook 13.4.3 and a native passkey bridge are verified against the current native toolchain before acceptance.

**Spec:** docs/superpowers/specs/2026-10-12-mobile-login-options-design.md

## Global constraints

- Keep current native runtime pins and the existing browser sign-in behavior.
- No secrets or environment-file reads; public SDK identifiers are configuration, provider signing keys stay server-side.
- No suppressions, unsafe HTML, TypeScript any, raised gate budgets or files over 350 lines.
- Runtime-enabled methods and platform capability determine visible choices. All labels/hints/errors land in English and Modern Standard Arabic.
- No browser cookie copied into native storage. Client profile data never establishes identity.
- New SDK dependencies require native linking/build evidence. Live SDK and passkey checks are reported individually when configuration is absent.

## Review focus

- A cancelled or replaced attempt must not persist late native tokens or complete another attempt.
- A security change between factor validation and consent must invalidate the older proof.
- A replay or concurrent completion must produce at most one code/session and consume each recovery code/challenge once.
- A cold email-link callback must use the saved initiator secret and exact callback destination, without switching an existing account.
- A pruned generated project must compile and retain valid web alternatives for its chosen methods, including passkeys-only.

## Contract and ownership

Freeze this shared contract before parallel product edits. Types live in shared/sdk/src/types/native-auth.ts and paths in shared/sdk/src/native-auth/paths.ts. Keep the current auth.methods response compatible. Add a per-client public native method catalogue.

NativeFlow is signIn, registration or recovery. NativeStage is firstFactorRequired, emailLinkSent, registrationCodeRequired, recoveryCodeRequired, secondFactorRequired, consentRequired, codeReady or denied. NativeAttemptStart contains clientId, redirectUri, codeChallenge, codeChallengeMethod=S256, state, scopes and flow. Its result includes attemptId, attemptSecret, expiresAt and current stage. Attempt secrets are 256-bit random values; only hashes are stored. All subsequent operations require X-Native-Attempt and the opaque attemptId. Never expose the internal authorization transaction id.

A NativeAttemptView contains only display-safe stage, expiry, entered address, required factors, verified account summary and registered app/grant details. Secrets, provider credentials, codes and passwords never enter public snapshots, Redux state, notices or logs. NativeCodeReady contains the exact registered redirectUri with code/state and is consumed by the existing callback/code exchange.

NativeProviderCredential is a discriminated union: googleIdentityToken, appleIdentityTokenAndCode, facebookLimitedToken or facebookAccessToken. Google/Apple/Facebook Limited tokens carry the attempt nonce digest. Use a fresh interactive Google request, never its cached signIn result. Each mode has server-owned audience/app configuration. Microsoft and all other configured providers use system OAuth.

API routes under /api/auth/native:

- GET methods?clientId=... returns nativeEnabled, AuthMethods, per-provider SDK mode/public configuration and passkey readiness. It does not return secrets.
- POST attempts opens a native attempt after registered-client/redirect/scope/S256 validation.
- POST attempts/:id/password accepts email/password.
- POST attempts/:id/provider accepts NativeProviderCredential.
- POST attempts/:id/passkey/options and passkey/verify own the bound native assertion.
- POST attempts/:id/second-factor accepts exactly one code, recovery code or passkey assertion.
- POST attempts/:id/email-link/request and email-link/verify own native mail-token binding.
- POST attempts/:id/register and activate use existing registration/activation contracts.
- POST attempts/:id/recovery/request and recovery/confirm use existing recovery contracts.
- POST attempts/:id/consent approves only the account held in verified server state.
- POST attempts/:id/cancel ends the attempt without issuing a code.

Native JSON routes refuse browser session-cookie/Origin requests, require the attempt secret for mutations, use the corresponding existing feature/throttle policies and return normal typed API envelopes. Unknown/incorrect secrets are401; expired attempts are410; invalid stage or busy concurrent mutation is409; disabled features keep404 FEATURE_DISABLED. Centralize any new error codes and literals.

Native attempts expire according to the relevant existing factor/code lifetime, with a fixed maximum of 15 minutes. Existing browser authorization stays 5 minutes. Consent creates/approves a short-lived authorization code with the existing 60-second lifetime, using the stored S256 request. Completed factors and code issuance are persisted with one-winner guards and version fences. Idempotent consent retries can return the same short-lived code using an encrypted reply bound to the random attempt secret; no plaintext code or raw secret is stored. Database faults fail closed, with completed factors recoverable for consent when their completion committed.

Root owns shared SDK contracts, integration, manifests/lockfile, generator changes, documentation and final GitHub steps. Backend lane owns backend/auth/native, required reusable auth services, both persistence adapters, config validation and backend/shared error codes. Platform lane owns mobile/adapters native SDK ports and shell SDK wiring/config source; it does not edit manifests/lockfiles. Engine lane owns mobile/auth only. UI lane owns mobile/ui only. Frontend fallback fix and generator integration stay with root. Each writing lane has its own worktree. Start dependent lanes only after their consumed contracts exist.

### Task 1: Shared SDK protocol

Files: shared/sdk/src/types/native-auth.ts, shared/sdk/src/native-auth/client.ts, shared/sdk/src/native-auth/parsers.ts, shared/sdk/src/native-auth/paths.ts; shared/sdk/src/client.ts and index.ts; focused native-auth contract tests.

Produces ApiClient.nativeAuth.methods(clientId), start(input), password(attempt,input), provider(attempt,input), passkeyOptions(attempt), passkeyVerify(attempt,input), secondFactor(attempt,input), requestEmailLink(attempt,email), verifyEmailLink(attempt,token), register(attempt,email), activate(attempt,input), requestRecovery(attempt,email), confirmRecovery(attempt,input), consent(attempt), cancel(attempt). Attempt is {id,secret}; request header construction stays inside this client.

- [ ] Record cases for exact verbs/paths/body/headers, malformed views/credentials, safe identifier encoding, feature omissions and cancellation.
- [ ] Add failing contract tests with hand-written requests/responses and no native/browser cookie header.
- [ ] Implement parsers with strict discriminants, bounds and no permissive identity assertion.
- [ ] Run SDK tests/typecheck; mutate header/path or stage validation and prove the guarded test fails.
- [ ] Commit source and focused contracts by concern.

### Task 2: Persisted native attempt and completion

Files: backend/src/auth/native/native-auth.module.ts, native-auth.controller.ts, native-attempt.service.ts, constants/native-auth.ts, types/native-attempt.ts, stores/native-attempt.store.ts; persistence/mongo and persistence/postgres adapters; next numbered PostgreSQL migration; native configuration utilities. Split controller, state transitions and consent/code reply by responsibility.

Consumes Task1 wire contract. Produces NativeAttemptService.start, authenticateRequest, transitionIn, cancel and completeConsent, plus server-verified Principal and NativeFactorResult interfaces consumed by factor adapters.

- [ ] Cases: invalid client/redirect/S256/scope, disabled native mode, incorrect secret, unknown/expired/busy stage, cookie/Origin refusal, nonce rotation, cancellation and concurrent transitions.
- [ ] Add real MongoDB/PostgreSQL attempt contracts with seeded clock and guarded writes.
- [ ] Implement persisted attempt guards, bounded expiry and actor/epoch binding; share existing native request validation.
- [ ] Extend the existing authorization approval boundary for an already-verified native principal in one unit of work. Recheck captured account/client/grant versions and blocked grants.
- [ ] Persist encrypted idempotent code replies, with 60-second expiry, using an attempt-secret-derived key and authenticated encryption. Test wrong key, tampering and repeated consent.
- [ ] Run contracts and existing native authorization tests; prove double-completion, version-fence and ciphertext mutations red.
- [ ] Commit persistence/migration separately from source/contracts.

### Task 3: Password and native MFA

Files: backend/src/auth/native/factors/password-factor.service.ts, second-factor.service.ts; shared password verification extracted from AuthService; existing second-factor verification/challenge stores as needed.

Consumes NativeAttemptService and Principal. Produces password/second-factor route handlers that return NativeAttemptView.

- [ ] Cases: valid/invalid/unknown/deleted account, constant-cost unknown-address path, password disabled, MFA enabled/disabled, wrong/expired codes, lockout, recovery replay, account change and concurrent answers.
- [ ] Write contracts that query real session/attempt records and prove no code before MFA and consent.
- [ ] Extract shared credential checking from browser completion. Keep the existing web response/cookie behavior unchanged.
- [ ] Consume MFA proof and advance durable native factor state atomically. Keep native/browser challenge contexts distinct and the existing factor rules.
- [ ] Run native factor contracts and existing password/MFA suites; mutate required-factor and single-use guards red.
- [ ] Commit extraction, native factor source and tests by concern.

### Task 4: Native email-link, registration and recovery

Files: backend/src/auth/native/factors/email-link.service.ts, lifecycle/registration.service.ts, lifecycle/recovery.service.ts; existing mail/code/activation services and stores for reused validation and completion.

Consumes NativeAttemptService. Produces the mail/lifecycle routes in Task1 without browser cookies.

- [ ] Cases: generic unknown-address replies, mail caps, resend invalidation, expired/replayed/mismatched link, wrong-device binding, registration duplicate/deleted address, code lockout, activation commit ambiguity, password reset and all-session invalidation.
- [ ] Add real persistence contracts and mail-boundary assertions. Pass an actual request-produced link/token into its real native verifier.
- [ ] Bind mail-link token hash to the attempt and exact callback. Preserve its secret and PKCE context for cold starts. No forwarded native link authenticates an unrelated attempt.
- [ ] Reuse registration code consumption/account creation, then complete native factor state. Report activation success separately if later sign-in fails.
- [ ] Reuse recovery validation/password update/session invalidation. Return to signed-out login after a persisted reset.
- [ ] Run native and existing mail/registration/recovery suites; mutate binding, replay and revocation guards red.
- [ ] Commit each lifecycle concern with its contracts.

### Task 5: Provider SDK server verification

Files: backend/src/auth/oauth/native/google-native-verifier.ts, apple-native-verifier.ts, facebook-native-verifier.ts; backend/src/auth/native/factors/provider-factor.service.ts; provider-native config and focused verifier tests.

Consumes NativeFactorResult/Principal and per-client SDK configuration. Produces verified profiles passed to the existing subject-first resolver and native MFA/consent boundary.

- [ ] Cases: signatures, trusted issuer/audience, missing/replayed nonce, expiry, unknown provider mode, disabled/unconfigured SDK, Apple code/identity subject mismatch, Facebook app introspection and Limited JWT, unsafe automatic linking.
- [ ] Add deterministic provider-boundary tests with fixed signing keys/clock and real JWT verification. Do not mock the verifier under test.
- [ ] Implement Google fresh nonce JWT, Apple nonce JWT plus one-use native code exchange, Facebook Limited JWT and Android app-token introspection. Reuse existing HTTP/JWT helpers and profile/account policy.
- [ ] Advertise only configured native modes, retaining all other enabled provider entries as system OAuth.
- [ ] Run verifier/account-linking suites; mutate audience/nonce/signature/subject checks red.
- [ ] Commit each provider concern separately.

### Task 6: Native passkey server ceremony

Files: backend/src/auth/native/factors/passkey-factor.service.ts; shared assertion validation extracted from PasskeyAssertionService; native-origin configuration/validation and focused contracts.

Consumes NativeAttemptService and platform assertion types. Produces attempt-bound native options/verify and an eligible MFA assertion path.

- [ ] Cases: correct RP/origin/challenge, Android app origin, iOS origin, unknown credential, signature/counter replay, UV present/absent, wrong account for MFA, cancelled/replaced ceremony.
- [ ] Test browser/native cross-use refusal and real signed assertions against both databases.
- [ ] Reuse signature/counter checking; native challenges have explicit attempt/purpose binding and exact origin allowlists. Keep existing browser RP/origin validation unchanged.
- [ ] Apply existing UV and same-factor MFA policy, then enter consent.
- [ ] Run new contracts and existing passkey suites; mutate challenge/origin/counter/UV guards red.
- [ ] Commit common extraction, native ceremony and tests by concern.

### Task 7: Shared platform SDK ports

Files: mobile/adapters/src/types/sign-in-modules.ts, ports/provider-sign-in.ts, ports/passkeys.ts and focused port tests; mobile/expo/src/native-sign-in.ts and mobile/cli/src/native-sign-in.ts; shell/engine wiring and public app config plugins.

Produces ProviderSignInPort.available/authenticate and PasskeyPort.available/authenticate. Results are success, cancelled, unavailable or failed; success contains only the verified-on-server artifact union, never an app account.

- [ ] Cases: platform capabilities, missing public config, SDK cancellation/error, Google interactive nonce request, Apple state/nonce, Facebook token mode, unsupported passkey and duplicate native prompt prevention.
- [ ] Test module-boundary adapters with hand-written artifacts and cancellation, including a real writer-to-reader shape handoff to Task1.
- [ ] Install pinned provider/passkey libraries through root-owned manifests. Implement typed injected adapters and provider-supplied buttons/branding.
- [ ] Add conditional public config for callback schemes, Apple capability and passkey/app-link association. Keep app secrets out of bundles.
- [ ] Build Expo iOS and compile CLI integration; record any native linking incompatibility before substituting a bridge.
- [ ] Commit source/config and tests by concern; root owns lockfile.

### Task 8: Native engine lifecycle

Files: mobile/auth/src/native-sign-in/controller.ts, actions.ts, callback.ts, restore.ts, persistence.ts and types/native-sign-in.ts; index.ts, runtime/snapshot and storage validators; focused engine/conformance tests.

Consumes ApiClient.nativeAuth plus Task7 ports. Produces AuthEngine.methods(), nativeSignIn(action), cancelNativeSignIn(), safe native attempt snapshot and typed continuation outcomes. Keep signIn(options?) as the browser option, backward compatible with no arguments. BrowserSignInOptions carries only a supported providerId, flow and locale. The backend validates these selectors and preserves the existing native approval continuation.

- [ ] Cases: every action through consent/code exchange, duplicate taps, method switch, offline, cancelled SDK, disposal, late factor/token/storage response, MFA continuity, email-link warm/cold return, expiry, restore and account switch.
- [ ] Write deterministic engine tests with fake boundary modules and real SDK parsing, without own-unit mocks.
- [ ] Persist only pending attempt secret/PKCE context and existing refresh record in secure storage. Never persist passwords, verification codes or provider tokens.
- [ ] Converge native codeReady on the existing callback/token/DPoP installation and late-revocation path. No UI token adoption.
- [ ] Cancel native state before a fresh browser flow; keep callback destinations/state exact and browser behavior backward compatible.
- [ ] Run native engine/conformance suites; mutate stale epoch, late revocation, destination and storage guards red.
- [ ] Commit each lifecycle concern with cases.

### Task 9: Native screens and forms

Files: mobile/ui/src/screens/SignInScreen.tsx, NativeCredentialScreen.tsx, NativeCodeScreen.tsx, NativeConsentScreen.tsx; hooks/use-native-sign-in.ts; components/TextField.tsx; types/native-sign-in.ts; constants and both catalogues; screen/controller tests.

Consumes safe engine snapshots and actions from Task8. Root view remains sign-in/account; nested auth steps stay in a shared native flow.

- [ ] Cases: enabled/disabled methods, loading/retry/empty state, submit routing, secret clearing, password visibility/autofill, keyboard/large-text scrolling, SDK/passkey cancellation, registration/activation/reset success, MFA and consent, web switch and LTR/RTL.
- [ ] Reuse existing buttons/notices/typography/confirm controls. Add one native text-input component with tokens and labels; do not duplicate installed primitives.
- [ ] Render provider SDK controls where required and all other configured providers as system-sheet actions. Show password, passkey, email-link, sign-up and recovery choices only when enabled.
- [ ] Handle persisted activation separately from a later failed login and return reset success to login.
- [ ] Add locale-parity and behavior tests, including selectors from message catalogues; do not assert presentation internals.
- [ ] Inspect real iOS English/Arabic, keyboard, scrolling, focus and native alerts. Report assistive-technology/hardware limits.
- [ ] Commit components/hooks, locale copy and tests by concern.

### Task 10: Web fallback and generator integration

Files: frontend/src/modules/auth/components/AuthMethodsGate.tsx and its existing tests; template.manifest.json, template.rewrites.json and generator native apply/prune code; generated subset contract tests; mobile and auth setup documentation.

Consumes the integrated file/dependency map. Produces generated projects without dangling method imports and configured callback/association guidance.

- [ ] Cases: passkeys-only web fallback; native target with password only, each SDK provider, passkeys only, email-link only and omitted native target; app identity rewrite and native public config.
- [ ] Wire validated provider/flow selection into the existing browser authorization entry and preserve its native approval continuation. A system-sheet provider button must open the chosen provider. No arbitrary URL or profile is accepted.
- [ ] Fix the web empty guard using the existing hasNoMethods value. Prove passkeys-only renders the real journey.
- [ ] Assign new files/packages/markers to existing feature ownership and native-core; preserve needsSignInSite for every native target.
- [ ] Document exact provider registrations and AASA/assetlinks requirements with public identifiers. Do not read or edit protected environment files.
- [ ] Run generator inventory/config tests and installed generated native/web subset checks. Prove a removed-feature import/dependency mutation red.
- [ ] Commit generator behavior, tests, docs and generated artifacts separately.

### Task 11: Integration, review and publication

- [ ] Integrate reviewed lane commits without editing a tree another lane is writing.
- [ ] Run full bans/inventory/dependency/contrast/lint/typecheck/unit/config/build gates on Node 22, one memory-heavy group per host.
- [ ] Run real MongoDB and PostgreSQL API gates, committed browser journeys and installed generated project smoke. Verify source SHA/tree against recorded results.
- [ ] Build and inspect native flows in Ego Lite and iOS Simulator; distinguish real SDK/passkey ceremonies from adapter contracts. Run Android where the toolchain/configuration supports it.
- [ ] Pin independent security/session, data-safety and test/UI reviews to exact head, fix every introduced finding and rerun affected gates.
- [ ] Push normally, open master-based reviewed PRs, attach them, verify live diff/threads, post COMMENT reviews and merge only under the existing user authorization and real gates.
- [ ] Update the shared checkout only when clean. Stop owned services, archive/remove owned worktrees, delete merged temporary branches and retain verification reports outside the repository.
