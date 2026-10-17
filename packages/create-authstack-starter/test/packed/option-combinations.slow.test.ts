import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildCli, scaffold } from '../support/combination-helpers.js';
import {
  expectBackendUnitTests,
  expectConfigTests,
  expectFrontendUnitTests,
  expectInstallsLintsBuilds,
} from '../combinations/combination-scenarios.js';

/**
 * Option combinations, slow by nature: each installs and builds a generated
 * project. Run with `pnpm --filter create-authstack-starter run test:combinations`.
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
      'backend/src/mail/catalog/ar/index.ts',
      'backend/test/mail/mail-locale-ar.e2e-spec.ts',
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
let built = { ok: false, output: '' };

beforeAll(async () => {
  workspace = mkdtempSync(join(inject('combinationRoot'), 'options-'));
  built = await buildCli();
});

afterAll(() => {
  if (workspace !== '') rmSync(workspace, { recursive: true, force: true });
});

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
});
