import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  prunePackageScripts,
  prunePackageDependencies,
  prunePackageWorkspaces,
  pruneRootPackage,
} from '../../src/prune/package-scripts.js';

function packageJson(scripts: Record<string, string>): Record<string, unknown> {
  return { name: 'app', private: true, scripts };
}

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-scripts-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('prunePackageScripts', () => {
  it('drops a script whose command runs a deleted file', () => {
    const result = prunePackageScripts(
      packageJson({ 'setup:prod': 'node scripts/setup-production.js', build: 'nest build' }),
      ['scripts/setup-production.js'],
    );

    expect(result.scripts).toEqual({ build: 'nest build' });
  });

  it('keeps a script whose file was not deleted', () => {
    const result = prunePackageScripts(packageJson({ init: 'node scripts/init.js' }), [
      'scripts/setup-production.js',
    ]);

    expect(result.scripts).toEqual({ init: 'node scripts/init.js' });
  });

  it('strips a deleted file from a node --test argument list', () => {
    const result = prunePackageScripts(
      packageJson({
        'test:config':
          'node --test scripts/config-transforms-tests/config-transforms.test.mjs scripts/check-backend-build.test.mjs',
      }),
      ['scripts/config-transforms-tests/config-transforms.test.mjs'],
    );

    expect(result.scripts).toEqual({
      'test:config': 'node --test scripts/check-backend-build.test.mjs',
    });
  });

  it.each([
    'scripts/guardrails/scanner/check-hard-bans.test.mjs',
    'scripts/eslint-policy.test.mjs',
    'scripts/guardrails/scanner/round4-patterns.test.mjs',
    'scripts/guardrails/scanner/checker.slow.mjs',
    'scripts/guardrails/git/git-cases.slow.mjs',
    'scripts/guardrails/*/*.test.mjs',
    'scripts/guardrails/*/*.slow.mjs',
    './scripts/guardrails/scanner/round4-patterns.test.mjs',
  ])('removes excluded repository tests from generated commands: %s', (path) => {
    const result = prunePackageScripts(
      packageJson({ 'test:config': `node --test ${path} scripts/check-backend-build.test.mjs` }),
      [],
    );

    expect(result.scripts).toEqual({
      'test:config': 'node --test scripts/check-backend-build.test.mjs',
    });
  });

  it('drops an excluded-only slow command and keeps ordinary scripts', () => {
    const result = prunePackageScripts(
      packageJson({
        'test:config:all':
          'node --test scripts/guardrails/*/*.test.mjs scripts/guardrails/*/*.slow.mjs',
        check: 'node scripts/check-hard-bans.mjs --staged',
      }),
      [],
    );

    expect(result.scripts).toEqual({ check: 'node scripts/check-hard-bans.mjs --staged' });
  });

  it('removes an all command that becomes identical after template exclusions', () => {
    const result = prunePackageScripts(
      packageJson({
        'test:config': 'node --test scripts/check-backend-build.test.mjs',
        'test:config:all':
          'node --test scripts/guardrails/*/*.slow.mjs scripts/check-backend-build.test.mjs',
      }),
      [],
    );

    expect(result.scripts).toEqual({
      'test:config': 'node --test scripts/check-backend-build.test.mjs',
    });
  });

  it('preserves a genuinely different all command', () => {
    const result = prunePackageScripts(
      packageJson({
        'test:config': 'node --test scripts/check-backend-build.test.mjs',
        'test:config:all': 'node --test scripts/check-contrast.test.mjs',
      }),
      [],
    );

    expect(result.scripts).toEqual({
      'test:config': 'node --test scripts/check-backend-build.test.mjs',
      'test:config:all': 'node --test scripts/check-contrast.test.mjs',
    });
  });

  it('matches a deleted path written with a leading ./', () => {
    const result = prunePackageScripts(
      packageJson({ deploy: 'node ./scripts/setup-production.js' }),
      ['scripts/setup-production.js'],
    );

    expect(result.scripts).toEqual({});
  });

  it('removes only the deleted part of a simple && chain', () => {
    const result = prunePackageScripts(
      packageJson({ check: 'pnpm run lint && node scripts/setup-production.js' }),
      ['scripts/setup-production.js'],
    );

    expect(result.scripts).toEqual({ check: 'pnpm run lint' });
  });

  it('drops a && chain when every part runs a deleted file', () => {
    const result = prunePackageScripts(
      packageJson({
        deploy: 'node scripts/setup-production.js && node scripts/setup-production.js',
      }),
      ['scripts/setup-production.js'],
    );

    expect(result.scripts).toEqual({});
  });

  it('fails loudly when a deleted file sits in a non-&& operator chain', () => {
    for (const command of [
      'pnpm run lint; node scripts/setup-production.js',
      'pnpm run lint || node scripts/setup-production.js',
      'pnpm run lint | node scripts/setup-production.js',
    ]) {
      expect(() =>
        prunePackageScripts(packageJson({ check: command }), ['scripts/setup-production.js']),
      ).toThrow(/Script "check" mixes a deleted file with shell operators/);
    }
  });

  it('leaves a package without scripts alone', () => {
    const result = prunePackageScripts({ name: 'app' }, ['scripts/setup-production.js']);

    expect(result).toEqual({ name: 'app' });
  });
});

describe('prunePackageWorkspaces', () => {
  it('copies the resolved folders from the pnpm workspace source', () => {
    const result = prunePackageWorkspaces({ workspaces: ['backend', 'mobile/*'] }, [
      'backend',
      'shared/core',
    ]);

    expect(result.workspaces).toEqual(['backend', 'shared/core']);
  });
});

describe('prunePackageDependencies', () => {
  it('removes references to workspace packages that were removed', () => {
    const packageJson = {
      devDependencies: { '@app/native-auth': 'workspace:*', eslint: '^9.0.0' },
      optionalDependencies: { '@app/native-auth': 'workspace:*' },
    };

    expect(prunePackageDependencies(packageJson, new Set(['@app/native-auth']))).toEqual({
      devDependencies: { eslint: '^9.0.0' },
      optionalDependencies: {},
    });
  });
});

describe('pruneRootPackage', () => {
  it('returns false for a missing file', async () => {
    const root = await tempRoot();

    await expect(pruneRootPackage(root, [])).resolves.toBe(false);
  });

  it('rejects invalid JSON with the file name', async () => {
    const root = await tempRoot();
    await writeFile(join(root, 'package.json'), '{ not json', 'utf8');

    await expect(pruneRootPackage(root, [])).rejects.toThrow(/Could not parse package\.json/);
  });

  it.each(['backend/package.json', 'tools/package.json'])(
    'names malformed nested JSON at %s',
    async (file) => {
      const root = await tempRoot();
      await writeFile(join(root, 'package.json'), '{}');
      await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages: [backend]\n');
      await mkdir(join(root, file.split('/')[0]));
      await writeFile(join(root, file), '{ broken');
      await expect(pruneRootPackage(root, [])).rejects.toThrow(`Could not parse ${file}:`);
    },
  );

  it('uses pnpm workspace folders to prune root workspace edges', async () => {
    const root = await tempRoot();
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages: [backend]\n', 'utf8');
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        workspaces: ['backend', 'mobile/*'],
        devDependencies: { '@app/native-auth': 'workspace:*', eslint: '^9.0.0' },
      }),
      'utf8',
    );
    await mkdir(join(root, 'backend'), { recursive: true });
    await mkdir(join(root, 'mobile/auth'), { recursive: true });
    await writeFile(join(root, 'backend/package.json'), JSON.stringify({ name: 'backend' }));
    await writeFile(
      join(root, 'mobile/auth/package.json'),
      JSON.stringify({ name: '@app/native-auth' }),
    );

    await pruneRootPackage(root, []);

    expect(JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))).toEqual({
      workspaces: ['backend'],
      devDependencies: { eslint: '^9.0.0' },
    });
  });
});
