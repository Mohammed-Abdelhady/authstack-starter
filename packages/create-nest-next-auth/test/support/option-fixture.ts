import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { validateManifest } from '../../src/manifest/validate.js';
import type { Manifest } from '../../src/types.js';

/** A version 2 manifest whose options own real files, for the option pruner. */
export const OPTION_MANIFEST: Manifest = validateManifest({
  version: 2,
  targets: {
    web: {
      label: 'Web app (Next.js)',
      default: true,
      files: [],
      workspaces: ['frontend'],
      envFiles: [],
    },
  },
  shared: {},
  databases: {
    mongodb: {
      label: 'MongoDB',
      default: true,
      files: [],
      envVars: [],
    },
  },
  options: {
    docker: {
      label: 'Docker files',
      default: true,
      files: [
        'docker-compose.yml',
        '**/Dockerfile',
        'scripts/config-transforms-tests/config-transforms.ports.test.mjs',
      ],
      requires: [],
      docs: [],
    },
    production: {
      label: 'Production nginx and compose',
      default: true,
      files: [
        'nginx/**',
        'docker-compose.prod.yml',
        'scripts/setup-production.js',
        'scripts/config-transforms-tests/config-transforms.test.mjs',
      ],
      requires: ['docker'],
      docs: ['docs/operations/deployment.md'],
    },
    'locale-ar': {
      label: 'Arabic locale',
      default: true,
      files: ['frontend/src/i18n/messages/ar.json', 'frontend/src/i18n/messages/*.ar.json'],
      requires: [],
      docs: [],
    },
  },
  presets: {},
  features: {
    'email-password': {
      label: 'Email and password',
      description: 'Password sign-in.',
      kind: 'credential',
      default: true,
      files: [],
      envVars: [],
      requires: [],
      docs: [],
    },
  },
  core: { alwaysRemoveFiles: [] },
});

const FILES: Record<string, string> = {
  'docker-compose.yml': 'services:\n  mongodb:\n',
  'backend/Dockerfile': 'FROM node:22\n',
  'nginx/nginx.conf': 'server {}\n',
  'docker-compose.prod.yml': 'services:\n  nginx:\n',
  'scripts/setup-production.js': 'console.log("setup");\n',
  'scripts/config-transforms-tests/config-transforms.test.mjs': 'export const fixture = true;\n',
  'scripts/config-transforms-tests/config-transforms.ports.test.mjs':
    'export const ports = true;\n',
  'docs/operations/deployment.md': '# Deployment\n',
  'frontend/src/i18n/messages/en.json': '{"hello":"Hello"}\n',
  'frontend/src/i18n/messages/ar.json': '{"hello":"مرحبا"}\n',
  'src/registry.ts': [
    'export const modules = [',
    '  dockerModule, // feature:docker',
    '  productionModule, // feature:production',
    '];',
    '',
  ].join('\n'),
  'README.md': [
    '# Project',
    '',
    '<!-- feature:docker:start -->',
    '## Start with Docker',
    'docker compose up',
    '<!-- feature:docker:end -->',
    '',
    '| Guide | Description |',
    '| ----- | ----------- |',
    '| [Deployment](./docs/operations/deployment.md) | Ship it |',
    '',
  ].join('\n'),
  'package.json': `${JSON.stringify(
    {
      name: 'template',
      version: '1.0.0',
      scripts: {
        build: 'nest build',
        'docker:up': 'docker compose up -d',
        'setup:prod': 'node scripts/setup-production.js',
        'test:config':
          'node --test scripts/config-transforms-tests/config-transforms.test.mjs scripts/config-transforms-tests/config-transforms.ports.test.mjs scripts/guardrails/scanner/check-hard-bans.test.mjs',
      },
    },
    null,
    2,
  )}\n`,
};

/** Writes a small tree shaped like a repo with option-owned files. */
export async function createOptionFixtureTree(
  overrides: Record<string, string> = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-options-'));
  for (const [path, content] of Object.entries({ ...FILES, ...overrides })) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
  return root;
}
