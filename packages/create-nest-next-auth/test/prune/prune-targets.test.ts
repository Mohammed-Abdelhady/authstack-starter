import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { resolveOwnership } from '../../src/manifest/ownership.js';
import { resolvePlan } from '../../src/manifest/plan.js';
import { prune } from '../../src/prune/index.js';
import type { PruneResult } from '../../src/types.js';
import { createTargetsTree, TARGETS_MANIFEST } from '../support/targets-fixture.js';

const require = createRequire(import.meta.url);
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function generate(
  targets: string[],
  overrides: Record<string, string> = {},
): Promise<{ root: string; result: PruneResult }> {
  const root = await createTargetsTree(overrides);
  roots.push(root);
  const plan = resolvePlan(TARGETS_MANIFEST, { targets });
  const result = await prune(
    root,
    TARGETS_MANIFEST,
    plan.features,
    plan.options,
    'strict',
    resolveOwnership(TARGETS_MANIFEST, plan),
  );
  return { root, result };
}

function present(root: string, paths: string[]): string[] {
  return paths.filter((path) => existsSync(join(root, path)));
}

async function text(root: string, path: string): Promise<string> {
  return readFile(join(root, path), 'utf8');
}

async function json(root: string, path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await text(root, path)) as Record<string, unknown>;
}

const CLIENT_FOLDERS = ['frontend', 'mobile/expo', 'mobile/cli', 'mobile/auth', 'kiosk'];

describe('pruning by the chosen clients', () => {
  it('leaves a web project with no mobile folder and nothing that names one', async () => {
    const { root, result } = await generate(['web']);

    expect(present(root, [...CLIENT_FOLDERS, 'mobile', 'kiosk.env.example'])).toEqual(['frontend']);
    expect(parse(await text(root, 'pnpm-workspace.yaml'))).toEqual({
      packages: ['backend', 'frontend'],
    });
    expect((await json(root, 'package.json')).workspaces).toEqual(['backend', 'frontend']);
    expect(await json(root, 'backend/package.json')).toEqual({
      name: 'backend',
      devDependencies: {},
    });
    expect(Object.keys(require(join(root, '.lintstagedrc.cjs')) as object)).toEqual([
      'backend/**/*.ts',
    ]);
    expect((require(join(root, 'commitlint.config.cjs')) as { scopes: string[] }).scopes).toEqual([
      'backend',
      'root',
    ]);
    expect(await text(root, 'scripts/policy.mjs')).toBe("export const SKIPPED = ['.husky/_/'];\n");
    expect(await text(root, '.gitignore')).toBe('# Dependencies\nnode_modules/\n');
    expect(await text(root, 'README.md')).toBe('# Project\n\n## Seed data\n');
    expect(result.dangling).toEqual([]);
  });

  it('keeps the Expo app with what it shares and removes the planned bare app', async () => {
    const { root, result } = await generate(['web', 'native-expo']);

    expect(present(root, CLIENT_FOLDERS)).toEqual(['frontend', 'mobile/expo', 'mobile/auth']);
    expect(parse(await text(root, 'pnpm-workspace.yaml'))).toEqual({
      packages: ['backend', 'frontend', 'mobile/*'],
    });
    expect((await json(root, 'package.json')).workspaces).toEqual([
      'backend',
      'frontend',
      'mobile/auth',
      'mobile/expo',
    ]);
    expect(Object.keys(require(join(root, '.lintstagedrc.cjs')) as object)).toEqual([
      'backend/**/*.ts',
      'mobile/**/*.ts',
      'mobile/auth/**/*.ts',
      'mobile/expo/**/*.ts',
    ]);
    const commitlint = await text(root, 'commitlint.config.cjs');
    expect((require(join(root, 'commitlint.config.cjs')) as { scopes: string[] }).scopes).toEqual([
      'backend',
      'mobile',
      'root',
    ]);
    expect(commitlint).not.toContain('feature:');
    expect(await text(root, 'scripts/policy.mjs')).toBe(
      "export const SKIPPED = ['mobile/expo/ios/', '.husky/_/'];\n",
    );
    expect(await text(root, '.gitignore')).toBe(
      '# Dependencies\nnode_modules/\n\n# Native projects Expo generates\nmobile/expo/ios/\nmobile/expo/android/\n',
    );
    expect(await text(root, 'README.md')).toBe(
      '# Project\n\n## Mobile app\n\nRun the Expo app.\n\n## Seed data\n',
    );
    expect(result.dangling).toEqual([]);
  });

  it('keeps the web app for the Expo app chosen alone', async () => {
    const { root, result } = await generate(['native-expo']);

    expect(present(root, CLIENT_FOLDERS)).toEqual(['frontend', 'mobile/expo', 'mobile/auth']);
    expect(result.dangling).toEqual([]);
  });

  it('removes the web app for a client that does not sign in through it', async () => {
    const { root } = await generate(['kiosk']);

    expect(present(root, [...CLIENT_FOLDERS, 'kiosk.env.example'])).toEqual([
      'kiosk',
      'kiosk.env.example',
    ]);
  });

  it('reports an import the Expo app still makes into the removed bare app', async () => {
    const { result } = await generate(['web', 'native-expo'], {
      'mobile/expo/src/bare.ts':
        "import { bare } from '../../cli/src/index';\nexport default bare;\n",
    });

    expect(result.dangling).toEqual([
      {
        file: 'mobile/expo/src/bare.ts',
        line: 1,
        specifier: '../../cli/src/index',
        target: 'mobile/cli/src/index',
      },
    ]);
  });
});
