export const AGENT_RULE_COPY: Record<string, { heading: string; sentence: string }> = {
  'Markup injection bypasses safe text and children.': {
    heading: 'Markup injection',
    sentence: 'These rules block browser APIs that treat text as markup.',
  },
  'Type escapes bypass compile-time checking.': {
    heading: 'Type escapes',
    sentence: 'These rules block casts and assertions that bypass type checks.',
  },
  'Suppression hides a failing gate instead of fixing its cause.': {
    heading: 'Hidden checks',
    sentence: 'These directives hide tool errors instead of fixing them.',
  },
  'Gate bypass flags disable required verification.': {
    heading: 'Gate bypass flags',
    sentence: 'These command flags skip required verification.',
  },
};

export const KNOWN_WORKSPACE_COPY: Record<string, string> = {
  backend: 'The NestJS API and its tests.',
  frontend: 'The Next.js web app.',
  'shared/core': 'Shared permissions and common types.',
  'shared/sdk': 'API routes, wire types, and the typed client.',
  'mobile/expo': 'The Expo mobile app.',
  'mobile/auth': 'The mobile sign-in engine. No React and no React Native.',
  'mobile/ui': 'The mobile screens.',
  'mobile/adapters': 'What connects the sign-in engine to the device.',
  'mobile/device-key': 'The signing key kept on the device.',
  'mobile/metro': 'Metro settings for the mobile workspaces.',
};

/** Where the Expo app keeps its identity. Its presence is what adds the section below. */
export const MOBILE_APP_CONFIG_PATH = 'mobile/expo/app.json';

/** What has been proven, and for which app. The README's mobile section carries the same words. */
export const MOBILE_PROOF_TEXT =
  "The template's Expo app, under its example name and ids, has been built and run on an iOS simulator. A generated app with its own name and ids has been linted, type checked, unit tested and bundled, but not launched.";

export const MOBILE_APP_TEXT = `## Mobile app

The Expo app is in \`mobile/expo\`. ${MOBILE_PROOF_TEXT} Android has not been built or run, so treat it as unverified.

- Run it on a simulator with \`pnpm --filter @app/mobile-expo run ios\`. This needs a Mac with Xcode and CocoaPods. The command keeps running to serve the JavaScript.
- The server needs \`AUTH_NATIVE_ENABLED=true\`, \`AUTH_NATIVE_DPOP_NONCE_SECRET\`, \`API_URL\` and \`AUTH_NATIVE_APPLICATIONS\`. \`backend/.env.example\` has the entry that matches the app. The backend does not start with the first one on until the secret and \`API_URL\` are set.
- The app talks to \`http://localhost:5001\` in development. Set \`EXPO_PUBLIC_API_ORIGIN\` when the API is somewhere else. \`API_URL\` on the server must be the same address.
- The web app must be running, because sign-in happens on its pages. Sign in with an account the server has, for example one from \`pnpm --filter backend run seed\`.
- The app name, slug, application id and scheme are in \`mobile/expo/app.json\`. The client id and the return address are built from the scheme. Do not copy them anywhere else.`;

export const STANDARD_CODE_TEXT =
  'Follow the workspace lint rules. Inline lint configuration is refused.';

export const STANDARD_NOT_ENFORCED =
  'The banned-construct scan and file length ceiling are off. The rules level was chosen at generation. Editing `.create-authstack-starter.json` does not switch it.';

export const COMMIT_MESSAGE_HOOK_TEXT =
  'The commit message hook checks this format. It also removes tool attribution trailers, such as a `Co-Authored-By` line that names a coding tool, and prints each line it removes.';

export const STANDARD_POLICY_LOCATION =
  '`scripts/check-hard-bans.mjs --commit-msg` and `scripts/ci.mjs` load this file, so keep it. The banned-construct scan and file length ceiling it defines are off at the standard rules level. Generate again with strict to turn them on.';

export const AGENTS_TEMPLATE = `# Project instructions

This file gives developers and coding agents the rules for this project.

Rules level: {{level}}.

## Code

Source file limit: {{fileLineLimit}} lines.

The checker applies this limit to the source files it covers. Split long files to stay within it.

Do not use these constructs.

{{bannedConstructs}}{{explicitTypeLint}}

## Commit messages

Use the format \`type(scope): subject\` or \`type: subject\`.

- Types: {{commitTypes}}
- Scopes: {{commitScopes}}
- Subject limit: {{subjectLimit}} characters.{{commitHook}}

## Checks

Run these checks before opening a pull request. Commands come from \`scripts/ci/gates.json\`.

{{checks}}

## What enforces this

{{hooks}}
{{actions}}
{{branchProtection}}

## What is not enforced

{{notEnforced}}

## Where things are

{{whereThingsAre}}{{mobileApp}}

## Package manager

Package manager: {{packageManager}} {{packageManagerVersion}}.

Use this package manager for project commands.
`;
