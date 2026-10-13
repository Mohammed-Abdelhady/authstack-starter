/**
 * A hand-written contract for the default selection. It names representative
 * paths instead of the whole tree, so adding an unrelated file does not turn
 * the e2e run red while a missing or leaked feature file still does.
 */

/** Paths a default run must produce. */
export const DEFAULT_SELECTION_MUST_EXIST = [
  'package.json',
  'README.md',
  '.gitignore',
  '.create-authstack-starter.json',
  'backend/package.json',
  'frontend/package.json',
  'backend/tsconfig.json',
  'frontend/tsconfig.json',
  'backend/src/main.ts',
  'backend/src/app.module.ts',
  'backend/src/auth/auth.module.ts',
  'frontend/src/app/layout.tsx',
  'frontend/src/modules/users/api/usersApi.ts',
  'backend/.env.example',
  '.env.docker.example',
  'frontend/.env.example',
  // email-password is a default feature.
  'frontend/src/modules/auth/methods/password/index.ts',
  'frontend/src/modules/auth/methods/password/PasswordSignInForm.tsx',
  // google, github and facebook are default providers.
  'backend/src/auth/oauth/strategies/google-oauth.strategy.ts',
  'backend/src/auth/oauth/strategies/github-oauth.strategy.ts',
  'backend/src/auth/oauth/strategies/facebook-oauth.strategy.ts',
  // oauth-core is hidden but follows every selected provider.
  'backend/src/auth/oauth/oauth.constants.ts',
  'backend/src/auth/oauth/oauth.controller.ts',
  'backend/src/auth/oauth/oauth.service.ts',
];

/** Paths a default run must not produce: off-by-default features and core removals. */
export const DEFAULT_SELECTION_MUST_NOT_EXIST = [
  // magic-link, totp and passkeys are off by default.
  'backend/src/auth/magic-link/magic-link.controller.ts',
  'backend/src/user/persistence/mongo/schemas/two-factor.schema.ts',
  'backend/src/auth/passkeys/persistence/mongo/schemas/passkey.schema.ts',
  // every provider that is off by default.
  'backend/src/auth/oauth/strategies/microsoft-oauth.strategy.ts',
  'backend/src/auth/oauth/strategies/apple-oauth.strategy.ts',
  'backend/src/auth/oauth/strategies/discord-oauth.strategy.ts',
  'backend/src/auth/oauth/strategies/linkedin-oauth.strategy.ts',
  'backend/src/auth/oauth/strategies/gitlab-oauth.strategy.ts',
  'backend/src/auth/oauth/strategies/x-oauth.strategy.ts',
  'backend/src/auth/oauth/strategies/slack-oauth.strategy.ts',
  'backend/src/auth/oauth/strategies/twitch-oauth.strategy.ts',
  'backend/src/auth/oauth/strategies/oidc-oauth.strategy.ts',
  // core.alwaysRemoveFiles.
  'frontend/e2e',
  'frontend/playwright.config.ts',
  'frontend/playwright.frontend.config.ts',
  'backend/test/utils/browser/browser-server.ts',
  'backend/test/utils/oauth/local-oauth.ts',
  'template.manifest.json',
  'template.rewrites.json',
  'openspec',
  '.hyperflow',
];
