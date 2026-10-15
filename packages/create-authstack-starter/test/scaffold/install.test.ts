import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installDependencies, pnpmAvailable, prepareLockfile } from '../../src/scaffold/install.js';
import { writePnpmBoundary } from '../support/pnpm-boundary.js';
import {
  installFromWarmStore,
  installProject,
  runBackendBoot,
} from '../support/combination-helpers.js';
import {
  expectConfigTests,
  expectInstallsLintsBuilds,
  expectLints,
} from '../combinations/combination-scenarios.js';
import { parse } from 'yaml';
import { PACKAGE_MANAGER_VERSION } from '../../src/constants/index.js';

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function fakePnpm(failure = '', version = PACKAGE_MANAGER_VERSION): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'cna-pnpm-boundary-'));
  directories.push(directory);
  await writePnpmBoundary(directory, failure, version);
  vi.stubEnv('PATH', directory);
  return directory;
}

describe('pnpm installation boundary', () => {
  it('runs the generated backend boot check through its own installed Jest', async () => {
    const root = await fakePnpm();
    expect(await runBackendBoot(root)).toEqual({ ok: true, output: '', stdout: '' });
    expect(await readFile(join(root, 'calls'), 'utf8')).toBe(
      '--filter backend exec jest --config test/jest-e2e.json --runInBand --runTestsByPath test/app/app.boot.e2e-spec.ts\n',
    );
  });
  it('reports a failed generated backend boot check', async () => {
    const root = await fakePnpm('--config');
    const result = await runBackendBoot(root);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('registry refused the request');
  });
  it('uses only the warm store and frozen graph for offline installation', async () => {
    const root = await fakePnpm();
    expect(await installFromWarmStore(root, '/private/tmp/cna-test-store')).toEqual({
      ok: true,
      output: '',
      stdout: '',
    });
    expect(await readFile(join(root, 'calls'), 'utf8')).toBe(
      'install --offline --frozen-lockfile --store-dir /private/tmp/cna-test-store\n',
    );
  });
  it('starts no command of a combination step once the case was aborted', async () => {
    const root = await fakePnpm();
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages: [backend]\n');
    const aborted = AbortSignal.abort();

    const installed = await installProject(root, '/private/tmp/cna-test-store', aborted);
    const steps = await Promise.allSettled([
      expectInstallsLintsBuilds(root, '/private/tmp/cna-test-store', aborted),
      expectConfigTests(root, aborted),
      expectLints(root, aborted),
    ]);

    expect({
      installed: installed.ok,
      steps: steps.map((step) => step.status),
      called: existsSync(join(root, 'calls')),
    }).toEqual({
      installed: false,
      steps: ['rejected', 'rejected', 'rejected'],
      called: false,
    });
  });
  it('keeps combination gates on the same explicit temporary store', async () => {
    const root = await fakePnpm();
    await writeFile(
      join(root, 'pnpm-workspace.yaml'),
      'packages: [backend]\nallowBuilds: {bcrypt: true}\n',
    );
    expect(await installProject(root, '/private/tmp/cna-test-store')).toEqual({
      ok: true,
      output: '',
      stdout: '',
    });
    expect(parse(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8'))).toEqual({
      packages: ['backend'],
      allowBuilds: { bcrypt: true },
      storeDir: '/private/tmp/cna-test-store',
    });
    expect(await readFile(join(root, 'calls'), 'utf8')).toBe(
      'install --lockfile-only --store-dir /private/tmp/cna-test-store\ninstall --frozen-lockfile --store-dir /private/tmp/cna-test-store\n',
    );
  });
  it('updates the lockfile without running a dependency install', async () => {
    const root = await fakePnpm();
    await writeFile(join(root, 'pnpm-lock.yaml'), 'template lock\n', 'utf8');
    expect(await prepareLockfile(root)).toEqual({ ok: true });
    expect(await readFile(join(root, 'calls'), 'utf8')).toBe(
      '--version\ninstall --lockfile-only --prefer-offline\n',
    );
    expect(await readFile(join(root, 'pnpm-lock.yaml'), 'utf8')).toBe('template lock\n');
  });

  it('keeps the lockfile when the lockfile-only update fails', async () => {
    const root = await fakePnpm('--lockfile-only');
    await writeFile(join(root, 'pnpm-lock.yaml'), 'stale lock\n', 'utf8');
    expect(await prepareLockfile(root)).toEqual({
      ok: false,
      reason: 'registry refused the request',
    });
    expect(await readFile(join(root, 'calls'), 'utf8')).toBe(
      '--version\ninstall --lockfile-only --prefer-offline\n',
    );
    expect(await readFile(join(root, 'pnpm-lock.yaml'), 'utf8')).toBe('stale lock\n');
  });

  it('runs only the frozen install after the pre-commit update', async () => {
    const root = await fakePnpm();
    expect(await installDependencies(root)).toEqual({ ok: true });
    expect(await readFile(join(root, 'calls'), 'utf8')).toBe('install --frozen-lockfile\n');
  });

  it('reports a failed frozen install', async () => {
    const root = await fakePnpm('--frozen-lockfile');
    expect(await installDependencies(root)).toEqual({
      ok: false,
      reason: 'registry refused the request',
    });
    expect(await readFile(join(root, 'calls'), 'utf8')).toBe('install --frozen-lockfile\n');
  });

  it('accepts the pinned version and treats a different major as absent', async () => {
    const root = await fakePnpm();
    expect(await pnpmAvailable(root)).toBe(true);
    const unsupported = await fakePnpm('', '10.0.0');
    expect(await pnpmAvailable(unsupported)).toBe(false);
    await rm(join(root, 'pnpm'));
    vi.stubEnv('PATH', root);
    expect(await pnpmAvailable(root)).toBe(false);
  });
});
