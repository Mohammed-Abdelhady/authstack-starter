import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { loadManifest } from '../../src/manifest/load.js';
import { availableFeatures } from '../../src/manifest/select.js';
import type { Manifest } from '../../src/types.js';
import { buildCli, REPO_ROOT, scaffold } from '../support/combination-helpers.js';
import {
  expectBackendUnitTests,
  expectConfigTests,
  expectFrontendUnitTests,
  expectInstallsLintsBuilds,
} from '../combinations/combination-scenarios.js';
import {
  ARABIC_FORBIDDEN,
  DOCKER_FORBIDDEN,
  findForbiddenContent,
  PRODUCTION_FORBIDDEN,
} from '../support/reference-content.js';

/**
 * Option combinations, slow by nature: each installs and builds a generated
 * project. Run with `pnpm --filter create-nest-next-auth run test:combinations`.
 */

/** The four providers and the credential method a default run keeps. */
const DEFAULT_FEATURES = ['email-password', 'google', 'github', 'facebook'];

interface OptionCombination {
  name: string;
  flags: string[];
  mustExist: string[];
  mustNotExist: string[];
  /** Run the generated project's own unit suites (Arabic-off cases). */
  unitTests?: boolean;
}

const OPTION_COMBINATIONS: OptionCombination[] = [
  {
    name: 'production off',
    flags: ['--no-production'],
    mustExist: [
      'docker-compose.yml',
      'backend/Dockerfile',
      'scripts/config-transforms-tests/config-transforms.ports.test.mjs',
    ],
    mustNotExist: [
      'docker-compose.prod.yml',
      'docs/operations/deployment.md',
      'scripts/setup-production.js',
      'scripts/config-transforms-tests/config-transforms.test.mjs',
      'nginx/nginx.conf',
    ],
  },
  {
    name: 'docker and production off',
    flags: ['--no-docker', '--no-production'],
    mustExist: ['frontend/src/i18n/messages/ar.json'],
    mustNotExist: [
      'docker-compose.yml',
      '.env.docker.example',
      'backend/Dockerfile',
      'frontend/Dockerfile',
      'scripts/config-transforms-tests/config-transforms.ports.test.mjs',
      'scripts/verify-docker.mjs',
      'scripts/lib/docker-http-probes.mjs',
      'docker-compose.prod.yml',
      'nginx/nginx.conf',
    ],
  },
  {
    name: 'Arabic off',
    flags: ['--locales', 'en'],
    mustExist: ['frontend/src/i18n/messages/en.json'],
    mustNotExist: [
      'frontend/src/i18n/messages/ar.json',
      'frontend/src/i18n/messages/native-auth.ar.json',
      'frontend/src/components/LanguageSwitcher.tsx',
      'frontend/src/components/LanguageSwitcher.test.tsx',
    ],
    unitTests: true,
  },
  {
    name: 'docker, production and Arabic off',
    flags: ['--no-docker', '--no-production', '--locales', 'en'],
    mustExist: [],
    mustNotExist: [
      'docker-compose.yml',
      'docker-compose.prod.yml',
      'nginx/nginx.conf',
      '.env.docker.example',
      'frontend/src/i18n/messages/ar.json',
      'frontend/src/components/LanguageSwitcher.tsx',
      'docs/operations/deployment.md',
      'docs/operations/PRODUCTION-SETUP.md',
      'scripts/setup-production.js',
      'scripts/verify-docker.mjs',
    ],
    unitTests: true,
  },
];

let workspace = '';
let manifest: Manifest;
let built = { ok: false, output: '' };

beforeAll(async () => {
  workspace = mkdtempSync(join(inject('combinationRoot'), 'options-'));
  manifest = await loadManifest(REPO_ROOT);
  built = await buildCli();
});

afterAll(() => {
  if (workspace !== '') rmSync(workspace, { recursive: true, force: true });
});

/** Every feature the manifest offers; content checks run on the full set. */
function everything(): string[] {
  return availableFeatures(manifest)
    .filter(({ feature }) => feature.kind !== 'hidden')
    .map(({ id }) => id);
}

async function scaffoldEverything(name: string, flags: string[]): Promise<string> {
  const project = join(workspace, name);
  const result = await scaffold(project, everything(), flags);
  expect(result.ok, result.output).toBe(true);
  return project;
}

describe('generated projects with options off', () => {
  it('builds the CLI first', () => {
    expect(built.ok, built.output).toBe(true);
  });

  it.each(OPTION_COMBINATIONS)('installs, lints and builds with $name', async (combination) => {
    const project = join(workspace, combination.name.replace(/\W+/g, '-'));
    const result = await scaffold(project, DEFAULT_FEATURES, combination.flags);
    expect(result.ok, result.output).toBe(true);

    for (const path of combination.mustExist) {
      expect(existsSync(join(project, path)), `${path} should exist`).toBe(true);
    }
    for (const path of combination.mustNotExist) {
      expect(existsSync(join(project, path)), `${path} should be gone`).toBe(false);
    }

    await expectInstallsLintsBuilds(project, inject('pnpmStore'));
    if (combination.unitTests) {
      await expectFrontendUnitTests(project);
      await expectBackendUnitTests(project);
      await expectConfigTests(project);
    }
  });

  it('drops the root scripts that named deleted files', async () => {
    const project = join(workspace, 'scripts-off');
    const result = await scaffold(project, DEFAULT_FEATURES, [
      '--no-docker',
      '--no-production',
      '--locales',
      'en',
    ]);
    expect(result.ok, result.output).toBe(true);

    const root = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = root.scripts ?? {};
    expect(scripts).not.toHaveProperty('setup:prod');
    expect(scripts['test:config'] ?? '').not.toContain('config-transforms.test.mjs');
    expect(scripts['test:config'] ?? '').not.toContain('config-transforms.ports.test.mjs');
    expect(scripts).toHaveProperty('init');
  });

  it('leaves no docker, compose or nginx text anywhere when docker is off', async () => {
    const project = await scaffoldEverything('content-plain', [
      '--no-docker',
      '--no-production',
      '--locales',
      'en',
    ]);

    expect(findForbiddenContent(project, DOCKER_FORBIDDEN)).toEqual([]);
  });

  it('leaves no Arabic text anywhere when Arabic is off', async () => {
    const project = await scaffoldEverything('content-english', ['--locales', 'en']);

    expect(findForbiddenContent(project, ARABIC_FORBIDDEN)).toEqual([]);
  });

  it('leaves no nginx text anywhere when only production is off', async () => {
    const project = await scaffoldEverything('content-simple', ['--no-production']);

    expect(findForbiddenContent(project, PRODUCTION_FORBIDDEN)).toEqual([]);
  });
});
