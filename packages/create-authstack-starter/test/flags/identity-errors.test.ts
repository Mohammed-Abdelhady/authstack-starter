import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REINSTALL_HINT, TEMPLATE_IDENTITY_FILE } from '../../src/constants/index.js';
import { readTemplateIdentity } from '../../src/scaffold/answers.js';
import { fixtureRoot, manifestRootWith, run } from '../support/answers-helpers.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A package root whose package.json is created by `fill`. */
function installerRootWith(fill: (root: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), 'cna-installer-'));
  roots.push(root);
  fill(root);
  return root;
}

describe('a damaged package', () => {
  it('stops before writing when the template identity file is missing', async () => {
    const root = manifestRootWith(roots);
    const target = join(root, 'app');

    const { code, output } = await run(root, [target, '--yes', '--no-install', '--no-git']);

    expect(code).toBe(3);
    expect(output).toContain(`${TEMPLATE_IDENTITY_FILE} is missing`);
    expect(output).toContain(REINSTALL_HINT);
    expect(existsSync(target)).toBe(false);
  });

  it('stops before writing when the template identity file is not JSON', async () => {
    const root = manifestRootWith(roots, '{ not json');
    const target = join(root, 'app');

    const { code, output } = await run(root, [target, '--yes', '--no-install', '--no-git']);

    expect(code).toBe(3);
    expect(output).toContain(`${TEMPLATE_IDENTITY_FILE} is not valid JSON`);
    expect(existsSync(target)).toBe(false);
  });

  it('stops before writing when the template identity has the wrong shape', async () => {
    const root = manifestRootWith(roots, `${JSON.stringify({ sha256: 'deadbeef' }, null, 2)}\n`);
    const target = join(root, 'app');

    const { code, output } = await run(root, [target, '--yes', '--no-install', '--no-git']);

    expect(code).toBe(3);
    expect(output).toContain(`${TEMPLATE_IDENTITY_FILE} does not carry a 64-character sha256`);
    expect(existsSync(target)).toBe(false);
  });

  it('stops before writing when the installer package.json cannot be read', async () => {
    const root = fixtureRoot(roots);
    const installerRoot = installerRootWith((dir) => mkdirSync(join(dir, 'package.json')));
    const target = join(root, 'app');

    const { code, output } = await run(root, [target, '--yes', '--no-install', '--no-git'], {
      installerRoot,
    });

    expect(code).toBe(3);
    expect(existsSync(target)).toBe(false);
    expect(output).toContain(join(installerRoot, 'package.json'));
  });

  it('stops before writing when the installer package.json has no string name or version', async () => {
    const root = fixtureRoot(roots);
    const installerRoot = installerRootWith((dir) =>
      writeFileSync(join(dir, 'package.json'), '{"name": 42}\n', 'utf8'),
    );
    const target = join(root, 'app');

    const { code, output } = await run(root, [target, '--yes', '--no-install', '--no-git'], {
      installerRoot,
    });

    expect(code).toBe(3);
    expect(existsSync(target)).toBe(false);
    expect(output).toContain(join(installerRoot, 'package.json'));
  });

  // Catches a SHA-256 repository build that refuses its own template identity.
  it('reads back a 64-character commit from a SHA-256 repository', async () => {
    const sha256 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const commit = '7c2f0e5b9a41d83c6e17f29b05a4c8d3e61b7f0a92c54d18e3b06f7a29c4d51e';
    const root = manifestRootWith(roots, `${JSON.stringify({ sha256, commit }, null, 2)}\n`);

    await expect(readTemplateIdentity(root)).resolves.toEqual({ sha256, commit });
  });

  it('fails a dry run the same way', async () => {
    const root = manifestRootWith(roots);
    const target = join(root, 'app');
    mkdirSync(target, { recursive: true });

    const { code, output } = await run(root, [
      target,
      '--yes',
      '--dry-run',
      '--no-install',
      '--no-git',
    ]);

    expect(code).toBe(3);
    expect(output).toContain(`${TEMPLATE_IDENTITY_FILE} is missing`);
    expect(readdirSync(target)).toEqual([]);
  });
});
