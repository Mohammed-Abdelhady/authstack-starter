import { readdirSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { loadManifest } from '../../src/manifest/load.js';
import { fixtureRoot, type RunResult, run as runCli } from '../support/answers-helpers.js';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const roots: string[] = [];
const manifestRoot = fixtureRoot();

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
  await rm(manifestRoot, { recursive: true, force: true });
});

async function run(argv: string[]): Promise<RunResult> {
  return runCli(manifestRoot, argv);
}

async function emptyTarget(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-dry-'));
  roots.push(root);
  const target = join(root, 'my-app');
  await mkdir(target, { recursive: true });
  return target;
}

describe('--dry-run', () => {
  it('prints the manifest labels and writes nothing to the target directory', async () => {
    const target = await emptyTarget();
    const manifest = await loadManifest(REPO_ROOT);

    const { code, output } = await run([target, '--yes', '--dry-run', '--no-install', '--no-git']);

    expect(code).toBe(0);
    expect(readdirSync(target)).toEqual([]);
    expect(output).toContain(manifest.targets.web.label);
    expect(output).toContain(manifest.databases.mongodb.label);
    expect(output).toContain(manifest.features['email-password'].label);
    expect(output).toContain(manifest.options.docker.label);
  });

  it('exits 2 for a planned target and writes nothing', async () => {
    const target = await emptyTarget();

    const { code, output } = await run([
      target,
      '--yes',
      '--no-install',
      '--no-git',
      '--dry-run',
      '--targets',
      'native-cli',
    ]);

    expect(code).toBe(2);
    expect(output).toContain('"native-cli" is not available yet.');
    expect(readdirSync(target)).toEqual([]);
  });

  it('reports the options a run would remove and writes nothing', async () => {
    const target = await emptyTarget();
    const manifest = await loadManifest(REPO_ROOT);

    const { code, output } = await run([
      target,
      '--yes',
      '--dry-run',
      '--no-install',
      '--no-git',
      '--no-docker',
      '--no-production',
    ]);

    expect(code).toBe(0);
    expect(readdirSync(target)).toEqual([]);
    expect(output).toContain(
      `Removed    ${manifest.options.docker.label}, ${manifest.options.production.label} (options)`,
    );
  });

  it('exits 2 when docker is off but production is still requested', async () => {
    const target = await emptyTarget();

    const { code, output } = await run([
      target,
      '--yes',
      '--dry-run',
      '--no-install',
      '--no-git',
      '--no-docker',
    ]);

    expect(code).toBe(2);
    expect(output).toContain('"production" needs "docker", which was turned off.');
    expect(readdirSync(target)).toEqual([]);
  });

  it('validates the directory even when it writes nothing', async () => {
    const { code } = await run(['Bad Name!', '--yes', '--dry-run', '--no-install', '--no-git']);
    expect(code).toBe(2);
  });

  it('rejects a non-empty directory even when it writes nothing', async () => {
    const target = await emptyTarget();
    await writeFile(join(target, 'existing.txt'), 'taken\n');

    const { code } = await run([target, '--yes', '--dry-run', '--no-install', '--no-git']);
    expect(code).toBe(2);
  });
});
