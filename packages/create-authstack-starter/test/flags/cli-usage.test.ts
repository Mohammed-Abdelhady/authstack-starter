import { copyFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { MANIFEST_FILE, TEMPLATE_IDENTITY_FILE } from '../../src/constants/index.js';
import type { PlanError } from '../../src/manifest/plan-types.js';
import { isRecord } from '../../src/manifest/read.js';
import { describePlanErrors } from '../../src/report/summary.js';
import {
  fixtureRoot,
  type RunResult,
  run as runCli,
  TEMPLATE_SHA,
} from '../support/answers-helpers.js';
import { PLAN_MANIFEST } from '../support/plan-fixture.js';

const PLANNED_FEATURE_ID = 'planned-feature';
const roots: string[] = [];
const manifestRoot = fixtureRoot();

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
  await rm(manifestRoot, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-usage-'));
  roots.push(root);
  return root;
}

/** Runs the CLI against this file's manifest root. */
function run(argv: string[]): Promise<RunResult> {
  return runCli(manifestRoot, argv);
}

/** The line the CLI prints for one plan error, read from where it is written. */
function sentenceFor(error: PlanError): string {
  return describePlanErrors(PLAN_MANIFEST, [error])[0];
}

/** A manifest root with one genuinely planned catalogue entry. */
function plannedRoot(dimension: 'databases' | 'features' = 'databases'): string {
  const root = mkdtempSync(join(tmpdir(), 'cna-usage-planned-'));
  roots.push(root);
  const manifest: unknown = JSON.parse(readFileSync(join(manifestRoot, MANIFEST_FILE), 'utf8'));
  const entries = isRecord(manifest) ? manifest[dimension] : undefined;
  if (!isRecord(entries)) throw new Error('the manifest has no requested catalogue');
  if (dimension === 'databases')
    entries.postgres = { label: 'PostgreSQL', default: false, status: 'planned' };
  else
    entries[PLANNED_FEATURE_ID] = {
      ...PLAN_MANIFEST.features['email-password'],
      default: false,
      status: 'planned',
    };
  writeFileSync(join(root, MANIFEST_FILE), JSON.stringify(manifest));
  copyFileSync(join(manifestRoot, TEMPLATE_IDENTITY_FILE), join(root, TEMPLATE_IDENTITY_FILE));
  return root;
}

/** A fresh target directory plus the common no-write flags. */
async function target(): Promise<{ path: string; flags: string[] }> {
  const root = await tempRoot();
  const path = join(root, 'my-app');
  await mkdir(path, { recursive: true });
  return { path, flags: [path, '--yes', '--no-install', '--no-git'] };
}

describe('usage errors exit 2', () => {
  it('rejects an unknown feature id and names it', async () => {
    const { flags } = await target();
    const { code, output } = await run([...flags, '--features', 'google,nope']);
    expect(code).toBe(2);
    expect(output).toContain('nope');
    expect(output).not.toContain('not available yet, skipped');
  });

  it('requires English in a locale list', async () => {
    const missing = await run([...(await target()).flags, '--dry-run', '--locales', 'ar']);
    expect(missing.code).toBe(2);
    expect(missing.output).toContain('--locales must include "en".');

    const empty = await run([...(await target()).flags, '--dry-run', '--locales', '']);
    expect(empty.code).toBe(2);
    expect(empty.output).toContain('--locales must include "en".');
  });

  it('rejects a hidden feature id requested directly', async () => {
    const { code, output } = await run([...(await target()).flags, '--features', 'oauth-core']);
    expect(code).toBe(2);
    expect(output).toContain('oauth-core');
  });

  it('reports a flag error before any prompt', async () => {
    const { code, output } = await run(['app', '--database', 'mysql']);
    expect(code).toBe(2);
    expect(output).toContain('mysql');
    expect(output).not.toContain('No terminal to prompt in');
  });

  it('reports a planned database before any prompt', async () => {
    const { code, output } = await runCli(plannedRoot(), ['app', '--database', 'postgres']);
    expect(code).toBe(2);
    expect(output).toContain('postgres');
    expect(output).not.toContain('No terminal to prompt in');
  });

  it('accepts a repeated database id after deduplication', async () => {
    const { code, output } = await run([
      ...(await target()).flags,
      '--dry-run',
      '--database',
      'mongodb,mongodb',
    ]);
    expect(code).toBe(0);
    expect(output).not.toContain('Choose exactly one database');
  });

  it('rejects an unknown preset', async () => {
    const { code, output } = await run([
      ...(await target()).flags,
      '--dry-run',
      '--preset',
      'nope',
    ]);
    expect(code).toBe(2);
    expect(output).toContain('nope');
  });
});

describe('config file usage errors exit 2', () => {
  async function config(content: string): Promise<string> {
    const root = await tempRoot();
    const path = join(root, 'config.json');
    await writeFile(path, content, 'utf8');
    return path;
  }

  function answersConfig(features: string[], sha256 = TEMPLATE_SHA): Promise<string> {
    return config(
      JSON.stringify({
        schemaVersion: 4,
        packageManager: 'pnpm@12.6.0',
        rules: { policy: 'strict' },
        installer: { name: 'create-authstack-starter', version: '0.1.0' },
        template: { sha256, commit: null },
        answers: {
          targets: ['web'],
          database: 'mongodb',
          features,
          options: [],
          locales: ['en'],
        },
      }),
    );
  }

  it('reports a missing file', async () => {
    const { code, output } = await run([
      ...(await target()).flags,
      '--dry-run',
      '--config',
      join(tmpdir(), 'cna-usage-missing', 'config.json'),
    ]);
    expect(code).toBe(2);
    expect(output).toContain('config file not found');
  });

  it('reports invalid JSON', async () => {
    const path = await config('{ not json');
    const { code, output } = await run([...(await target()).flags, '--dry-run', '--config', path]);
    expect(code).toBe(2);
    expect(output).toContain('not valid JSON');
  });

  it('reads a valid config and applies its selection', async () => {
    const path = await config(JSON.stringify({ features: ['email-password'] }));
    const { code, output } = await run([...(await target()).flags, '--dry-run', '--config', path]);
    expect(code).toBe(0);
    expect(output).toContain('Email and password');
  });

  // Catches a regeneration from a template other than the one the answers file records.
  it('refuses an answers file made from another template and writes nothing', async () => {
    const recorded = 'b'.repeat(64);
    const path = await answersConfig(['email-password'], recorded);
    const { path: project, flags } = await target();
    const { code, output } = await run([...flags, '--config', path]);
    expect({
      code,
      namesBoth: output.includes(recorded) && output.includes(TEMPLATE_SHA),
      written: readdirSync(project),
    }).toEqual({ code: 2, namesBoth: true, written: [] });
  });

  // Catches replay generating a project with an unimplemented feature silently omitted.
  it.each([PLANNED_FEATURE_ID])(
    'refuses planned %s in a v4 answers file and writes nothing',
    async (feature) => {
      const path = await answersConfig(['email-password', feature]);
      const { path: project, flags } = await target();
      const { code, output } = await runCli(plannedRoot('features'), [...flags, '--config', path]);
      expect(code).toBe(2);
      expect(output).toContain(sentenceFor({ id: feature, reason: 'planned' }));
      expect(readdirSync(project)).toEqual([]);
    },
  );

  it('refuses a planned feature from --config', async () => {
    const path = await config(JSON.stringify({ features: [PLANNED_FEATURE_ID] }));
    const { code, output } = await runCli(plannedRoot('features'), [
      ...(await target()).flags,
      '--dry-run',
      '--config',
      path,
    ]);
    expect(code).toBe(2);
    expect(output).toContain(sentenceFor({ id: PLANNED_FEATURE_ID, reason: 'planned' }));
  });
});
