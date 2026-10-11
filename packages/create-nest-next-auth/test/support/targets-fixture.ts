import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { validateManifest } from '../../src/manifest/validate.js';
import type { Manifest } from '../../src/types.js';

const WORKSPACE = { requires: [], docs: [], envVars: [] };

/**
 * A manifest whose clients own real files: a web app, an available mobile app,
 * a planned one, a shared module both need, and a kiosk that needs neither the
 * sign-in site nor anything shared.
 */
export const TARGETS_MANIFEST: Manifest = validateManifest({
  version: 2,
  targets: {
    web: {
      label: 'Web',
      default: true,
      files: ['frontend/**'],
      workspaces: ['frontend'],
      envFiles: [],
    },
    'native-expo': {
      label: 'Expo app',
      default: false,
      files: ['mobile/expo/**'],
      workspaces: ['mobile/expo'],
      requires: { shared: ['native-core'], targets: [] },
      needsSignInSite: true,
    },
    'native-cli': {
      label: 'Bare app',
      default: false,
      status: 'planned',
      files: ['mobile/cli/**'],
      workspaces: ['mobile/cli'],
      requires: { shared: ['native-core'] },
      needsSignInSite: true,
    },
    kiosk: {
      label: 'Kiosk',
      default: false,
      files: ['kiosk/**'],
      workspaces: ['kiosk'],
      envFiles: ['kiosk.env.example'],
    },
  },
  shared: {
    'native-core': { files: ['mobile/auth/**'], workspaces: ['mobile/auth'] },
  },
  databases: {
    mongodb: { label: 'MongoDB', default: true, files: [], envVars: [] },
  },
  options: {},
  presets: {
    everything: { targets: 'available', features: 'available', options: 'available' },
  },
  features: {
    'email-password': {
      label: 'Email and password',
      description: 'Password sign-in.',
      kind: 'credential',
      default: true,
      files: [],
      ...WORKSPACE,
    },
  },
  core: { alwaysRemoveFiles: [] },
});

function manifestFile(name: string, dependencies: Record<string, string> = {}): string {
  return `${JSON.stringify({ name, version: '1.0.0', dependencies }, null, 2)}\n`;
}

export const REGISTRATION_EXAMPLE = `# AUTH_NATIVE_APPLICATIONS='[{"clientId":"com.example.mobile","displayName":"Example Mobile","redirectUris":["com.example.mobile://oauth/callback"]}]'`;

const FILES: Record<string, string> = {
  '.prettierrc': '{ "singleQuote": true }\n',
  'package.json': `${JSON.stringify(
    {
      name: 'template',
      version: '1.0.0',
      workspaces: ['backend', 'frontend', 'mobile/*', 'kiosk'],
    },
    null,
    2,
  )}\n`,
  'pnpm-workspace.yaml': 'packages:\n  - backend\n  - frontend\n  - mobile/*\n  - kiosk\n',
  'backend/package.json': `${JSON.stringify(
    { name: 'backend', devDependencies: { '@app/native-auth': 'workspace:*' } },
    null,
    2,
  )}\n`,
  'backend/.env.example': `AUTH_NATIVE_ENABLED=false\n${REGISTRATION_EXAMPLE}\n`,
  'backend/README.md': ['# Backend', '', '```bash', REGISTRATION_EXAMPLE.slice(2), '```', ''].join(
    '\n',
  ),
  'frontend/package.json': manifestFile('frontend'),
  'frontend/src/page.tsx': 'export const page = 1;\n',
  'kiosk/package.json': manifestFile('kiosk'),
  'kiosk.env.example': 'KIOSK=1\n',
  'mobile/expo/package.json': manifestFile('@app/mobile-expo', {
    '@app/native-auth': 'workspace:*',
  }),
  'mobile/expo/app.json': `${JSON.stringify(
    {
      expo: {
        name: 'Mobile Expo',
        slug: 'mobile-expo',
        version: '0.1.0',
        scheme: 'com.example.mobile',
        ios: { bundleIdentifier: 'com.example.mobileexpo', infoPlist: { Kept: true } },
        android: { package: 'com.example.mobileexpo' },
        plugins: ['expo-secure-store'],
      },
    },
    null,
    2,
  )}\n`,
  'mobile/expo/src/index.ts':
    "import { engine } from '../../auth/src/index';\nexport const app = engine;\n",
  'mobile/cli/package.json': manifestFile('@app/mobile-cli', { '@app/native-auth': 'workspace:*' }),
  'mobile/cli/src/index.ts': 'export const bare = 1;\n',
  'mobile/auth/package.json': manifestFile('@app/native-auth'),
  'mobile/auth/src/index.ts': 'export const engine = 1;\n',
  '.lintstagedrc.cjs': [
    'module.exports = {',
    "  'backend/**/*.ts': ['prettier --write'],",
    "  'mobile/**/*.ts': ['prettier --write'],",
    "  'mobile/auth/**/*.ts': ['eslint --fix'],",
    "  'mobile/cli/**/*.ts': ['eslint --fix'],",
    "  'mobile/expo/**/*.ts': ['eslint --fix'],",
    '};',
    '',
  ].join('\n'),
  'commitlint.config.cjs': [
    'module.exports = {',
    '  scopes: [',
    "    'backend',",
    "    'mobile', // feature:native-core",
    "    'root',",
    '  ],',
    '};',
    '',
  ].join('\n'),
  'scripts/policy.mjs': [
    'export const SKIPPED = [',
    "  'mobile/expo/ios/', // feature:native-expo",
    "  '.husky/_/',",
    '];',
    '',
  ].join('\n'),
  '.gitignore': [
    '# Dependencies',
    'node_modules/',
    '',
    '# Native projects Expo generates',
    'mobile/expo/ios/',
    'mobile/expo/android/',
    '',
  ].join('\n'),
  'README.md': [
    '# Project',
    '',
    '<!-- feature:native-expo:start -->',
    '## Mobile app',
    'Run the Expo app.',
    '<!-- feature:native-expo:end -->',
    '',
    '## Seed data',
    '',
  ].join('\n'),
};

/** Writes a small tree with every client's workspace in it. */
export async function createTargetsTree(overrides: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-targets-'));
  for (const [path, content] of Object.entries({ ...FILES, ...overrides })) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
  return root;
}
