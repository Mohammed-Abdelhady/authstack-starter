import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import TEMPLATE_SYNC_INPUTS from '../../scripts/template-sync-inputs.json' with { type: 'json' };
import { commandEnvironment } from '../../src/utils/exec.js';

const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE_PACKAGE = 'packages/create-nest-next-auth';

export function copySyncTemplateInputs(fixture: string): void {
  for (const file of Object.values(TEMPLATE_SYNC_INPUTS)) {
    const target = join(fixture, FIXTURE_PACKAGE, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(PACKAGE_DIR, file), target);
  }
}

/** Git for a fixture: no inherited repository, no developer configuration. */
export function fixtureGit(fixture: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: fixture,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...commandEnvironment(),
      GIT_CONFIG_GLOBAL: join(fixture, 'absent-global'),
      GIT_CONFIG_NOSYSTEM: '1',
    },
  });
}

/** Makes the fixture a repository and stages exactly the named paths. */
export function trackFiles(fixture: string, paths: string[]): void {
  fixtureGit(fixture, ['init', '--quiet']);
  fixtureGit(fixture, ['add', '--force', ...paths]);
}

export function syncScript(fixture: string): string {
  return join(fixture, FIXTURE_PACKAGE, TEMPLATE_SYNC_INPUTS.script);
}

export function templateOf(fixture: string): string {
  return join(fixture, FIXTURE_PACKAGE, 'template');
}

export function runScript(fixture: string): void {
  const script = join(fixture, FIXTURE_PACKAGE, TEMPLATE_SYNC_INPUTS.script);
  execFileSync(process.execPath, [script], { timeout: 10_000, stdio: 'pipe' });
}

export function newFixture(roots: string[]): string {
  const fixture = mkdtempSync(join(tmpdir(), 'cna-sync-'));
  roots.push(fixture);
  copySyncTemplateInputs(fixture);
  writeFileSync(join(fixture, 'template.manifest.json'), '{"features":{}}');
  return fixture;
}

/** Stages every file in the fixture, ignored ones included. */
export function trackAll(fixture: string): void {
  trackFiles(fixture, ['--all']);
}

export function buildTemplate(roots: string[], setup: (fixture: string) => void): string {
  const fixture = newFixture(roots);
  setup(fixture);
  trackAll(fixture);
  runScript(fixture);
  return join(fixture, 'packages/create-nest-next-auth/template');
}
