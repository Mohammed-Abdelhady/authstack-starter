import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { fixtureRoot, type RunResult, run as runCli } from '../support/answers-helpers.js';

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

  it('rejects a planned target id', async () => {
    const { code, output } = await run([
      ...(await target()).flags,
      '--dry-run',
      '--targets',
      'native-cli',
    ]);
    expect(code).toBe(2);
    expect(output).toContain('"native-cli" is not available yet.');
  });

  it('accepts a locale list that includes Arabic', async () => {
    const { code } = await run([...(await target()).flags, '--dry-run', '--locales', 'en,ar']);
    expect(code).toBe(0);
  });

  it('rejects docker off while production is still requested', async () => {
    const { code, output } = await run([...(await target()).flags, '--dry-run', '--no-docker']);
    expect(code).toBe(2);
    expect(output).toContain('"production" needs "docker", which was turned off.');
  });

  it('accepts docker and production off together', async () => {
    const { code } = await run([
      ...(await target()).flags,
      '--dry-run',
      '--no-docker',
      '--no-production',
    ]);
    expect(code).toBe(0);
  });

  it('accepts dropping Arabic with an English-only locale list', async () => {
    const { code, output } = await run([...(await target()).flags, '--dry-run', '--locales', 'en']);
    expect(code).toBe(0);
    expect(output).not.toContain('not available yet');
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

  it('deduplicates repeated target ids so the error prints once', async () => {
    const { code, output } = await run([
      ...(await target()).flags,
      '--dry-run',
      '--targets',
      'ghost,ghost',
    ]);
    expect(code).toBe(2);
    expect(output.split('ghost')).toHaveLength(2);
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

  it('does not add an empty-database error on top of an unknown one', async () => {
    const { code, output } = await run([
      ...(await target()).flags,
      '--dry-run',
      '--database',
      'mysql',
    ]);
    expect(code).toBe(2);
    expect(output).toContain('"mysql" is not a known choice.');
    expect(output).not.toContain('Select a database.');
  });

  it('accepts a preset in any case', async () => {
    const { code } = await run([...(await target()).flags, '--dry-run', '--preset', 'Standard']);
    expect(code).toBe(0);
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

  it('reports a directory instead of a raw EISDIR', async () => {
    const directory = await tempRoot();
    const { code, output } = await run([
      ...(await target()).flags,
      '--dry-run',
      '--config',
      directory,
    ]);
    expect(code).toBe(2);
    expect(output).toContain('directory, not a file');
    expect(output).not.toContain('EISDIR');
  });

  it('reports invalid JSON', async () => {
    const path = await config('{ not json');
    const { code, output } = await run([...(await target()).flags, '--dry-run', '--config', path]);
    expect(code).toBe(2);
    expect(output).toContain('not valid JSON');
  });

  it('reports an unknown key', async () => {
    const path = await config(JSON.stringify({ turbo: true }));
    const { code, output } = await run([...(await target()).flags, '--dry-run', '--config', path]);
    expect(code).toBe(2);
    expect(output).toContain('unknown key "turbo"');
  });

  it('reports a wrong type', async () => {
    const path = await config(JSON.stringify({ docker: 'yes' }));
    const { code, output } = await run([...(await target()).flags, '--dry-run', '--config', path]);
    expect(code).toBe(2);
    expect(output).toContain('docker must be a boolean');
  });

  it('reports an empty database string', async () => {
    const path = await config(JSON.stringify({ database: '' }));
    const { code, output } = await run([...(await target()).flags, '--dry-run', '--config', path]);
    expect(code).toBe(2);
    expect(output).toContain('database must be a non-empty string');
  });

  it('reads a valid config and applies its selection', async () => {
    const path = await config(JSON.stringify({ features: ['email-password'] }));
    const { code, output } = await run([...(await target()).flags, '--dry-run', '--config', path]);
    expect(code).toBe(0);
    expect(output).toContain('Email and password');
  });

  it('turns options off from a config file', async () => {
    const path = await config(JSON.stringify({ docker: false, production: false }));
    const { code, output } = await run([...(await target()).flags, '--dry-run', '--config', path]);
    expect(code).toBe(0);
    expect(output).toContain('Removed    Docker files, Production nginx and compose (options)');
  });
});
