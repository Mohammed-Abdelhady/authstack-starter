import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { validateManifest } from '../../src/manifest/validate.js';
import type { Manifest } from '../../src/types.js';

export const FIXTURE_MANIFEST: Manifest = validateManifest({
  features: {
    'email-password': {
      label: 'Email and password',
      description: 'Password sign-in.',
      kind: 'credential',
      default: true,
      files: [],
      envVars: ['SMTP_HOST', 'SHARED_KEY'],
      requires: [],
      docs: ['docs/setup/setup-smtp.md'],
    },
    alpha: {
      label: 'Alpha',
      description: 'Sign in with Alpha.',
      kind: 'oauth',
      default: true,
      files: ['src/strategies/alpha*.ts'],
      envVars: ['OAUTH_ALPHA_CLIENT_ID', 'SHARED_KEY'],
      requires: [],
      docs: ['docs/setup-alpha.md'],
    },
    beta: {
      label: 'Beta',
      description: 'Sign in with Beta.',
      kind: 'oauth',
      default: true,
      files: ['src/strategies/beta-oauth.strategy.ts'],
      envVars: ['OAUTH_BETA_CLIENT_ID'],
      requires: [],
      docs: ['docs/setup-beta.md'],
    },
    gamma: {
      label: 'Gamma',
      description: 'Not built yet.',
      kind: 'oauth',
      default: false,
      status: 'planned',
      files: [],
      envVars: [],
      requires: [],
      docs: [],
    },
  },
  core: { alwaysRemoveFiles: ['tooling/**'] },
});

/**
 * The same manifest with the client and shared ids the repository's own
 * tooling files mark lines for, for trees that copy those files.
 */
export const TOOLING_MANIFEST: Manifest = {
  ...FIXTURE_MANIFEST,
  targets: {
    ...FIXTURE_MANIFEST.targets,
    'native-expo': {
      label: 'Expo app',
      default: false,
      files: [],
      workspaces: [],
      envFiles: [],
      requires: { shared: ['native-core'], targets: [] },
      needsSignInSite: true,
    },
  },
  shared: { 'native-core': { files: [], workspaces: [] } },
};

const FILES: Record<string, string> = {
  'src/strategies/alpha-oauth.strategy.ts': 'export class AlphaStrategy {}\n',
  'src/strategies/alpha-oauth.strategy.spec.ts': "import '../strategies/alpha-oauth.strategy';\n",
  'src/strategies/beta-oauth.strategy.ts': 'export class BetaStrategy {}\n',
  'src/auth.module.ts': [
    "import { AlphaStrategy } from './strategies/alpha-oauth.strategy';",
    'export const strategies = [AlphaStrategy];',
    '',
  ].join('\n'),
  'tooling/internal.md': '# internal\n',
  'docs/setup/setup-smtp.md': '# SMTP\n',
  'docs/setup-alpha.md': '# Alpha\n',
  'docs/setup-beta.md': '# Beta\n',
  'docs/README.md': [
    '# Docs',
    '',
    '- **[SMTP](./setup/setup-smtp.md)** - mail setup',
    '- **[Alpha](./setup-alpha.md)** - Alpha sign-in',
    '- **[Beta](./setup-beta.md)** - Beta sign-in',
    '',
  ].join('\n'),
  'README.md': [
    '# Project',
    '',
    '| Guide | Description |',
    '| ----- | ----------- |',
    '| [Alpha](./docs/setup-alpha.md) | Alpha sign-in |',
    '| [Beta](./docs/setup-beta.md) | Beta sign-in |',
    '',
  ].join('\n'),
  'backend/.env.example': [
    '# Shared',
    'SHARED_KEY=shared',
    '',
    '# SMTP Configuration',
    'SMTP_HOST=smtp.example.com',
    '',
    '# Alpha OAuth (optional)',
    '# OAUTH_ALPHA_CLIENT_ID=alpha-id',
    '',
    '# Beta OAuth (optional)',
    '# OAUTH_BETA_CLIENT_ID=beta-id',
    '',
    '# Swagger',
    'SWAGGER_ENABLED=false',
    '',
  ].join('\n'),
  '.env.docker.example': [
    '# Alpha OAuth',
    'OAUTH_ALPHA_CLIENT_ID=',
    '',
    '# Beta OAuth',
    'OAUTH_BETA_CLIENT_ID=',
    '',
    '# Frontend',
    'NEXT_PUBLIC_API_URL=http://localhost:5000',
    '',
  ].join('\n'),
  'package.json': `${JSON.stringify({ name: 'template', version: '1.0.0' }, null, 2)}\n`,
};

/** Writes a small tree shaped like the repository into the OS temp directory. */
export async function createFixtureTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-prune-'));
  for (const [path, content] of Object.entries(FILES)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
  return root;
}
