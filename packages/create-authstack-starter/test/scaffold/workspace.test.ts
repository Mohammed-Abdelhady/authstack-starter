import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { globSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { parse } from 'yaml';
import { isRecord } from '../../src/manifest/read.js';
import { renderWorkspace } from '../../src/scaffold/workspace.js';

let root = '';
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function fixture(content: string): Promise<void> {
  root = await mkdtemp(join(tmpdir(), 'cna-workspace-'));
  await writeFile(join(root, 'pnpm-workspace.yaml'), content);
}

it('lists surviving workspaces and retains overrides and build approvals', async () => {
  await fixture(
    "# workspace settings\npackages: [backend, frontend, packages/*, shared/*]\noverrides: {diff: '>=8.0.3'}\nallowBuilds: {bcrypt: true, '@scarf/scarf': false}\nenablePrePostScripts: true\n",
  );
  for (const workspace of ['backend', 'shared/core']) {
    await mkdir(join(root, workspace), { recursive: true });
    await writeFile(join(root, workspace, 'package.json'), '{}');
  }
  await renderWorkspace(root);
  const rendered = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8');
  expect(parse(rendered)).toEqual({
    packages: ['backend', 'shared/*'],
    overrides: { diff: '>=8.0.3' },
    allowBuilds: { bcrypt: true, '@scarf/scarf': false },
    enablePrePostScripts: true,
  });
  expect(rendered).toContain('# workspace settings');
  expect(rendered).toContain("diff: '>=8.0.3'");
});

it('drops the build approvals it is given and keeps every other one', async () => {
  await fixture(
    "# workspace settings\npackages: [backend]\nallowBuilds:\n  '@embedded-postgres/darwin-arm64': true\n  '@embedded-postgres/darwin-x64': true\n  '@embedded-postgres/linux-arm64': true\n  '@embedded-postgres/linux-x64': true\n  '@scarf/scarf': false\n  bcrypt: true\nminimumReleaseAgeStrict: true\n",
  );
  await mkdir(join(root, 'backend'), { recursive: true });
  await writeFile(join(root, 'backend', 'package.json'), '{}');

  const changed = await renderWorkspace(root, [
    '@embedded-postgres/darwin-arm64',
    '@embedded-postgres/darwin-x64',
    '@embedded-postgres/linux-arm64',
    '@embedded-postgres/linux-x64',
    '@embedded-postgres/windows-x64',
  ]);

  const rendered = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8');
  expect({
    changed,
    workspace: parse(rendered),
    comment: rendered.includes('# workspace settings'),
  }).toEqual({
    changed: true,
    workspace: {
      packages: ['backend'],
      allowBuilds: { '@scarf/scarf': false, bcrypt: true },
      minimumReleaseAgeStrict: true,
    },
    comment: true,
  });
});

it.each(['packages: [42]\n', 'packages: backend\n', 'packages: [\n'])(
  'rejects malformed workspace configuration',
  async (content) => {
    await fixture(content);
    await expect(renderWorkspace(root)).rejects.toThrow();
    expect(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')).toBe(content);
  },
);

it('resolves root and pnpm workspace lists to the same package folders', async () => {
  const repository = fileURLToPath(new URL('../../../../', import.meta.url));
  const packageManifest: unknown = JSON.parse(
    await readFile(join(repository, 'package.json'), 'utf8'),
  );
  const workspace: unknown = parse(await readFile(join(repository, 'pnpm-workspace.yaml'), 'utf8'));
  if (!isRecord(packageManifest) || !Array.isArray(packageManifest.workspaces)) {
    throw new Error('The root package manifest has no workspace list.');
  }
  if (!isRecord(workspace) || !Array.isArray(workspace.packages)) {
    throw new Error('The pnpm workspace file has no package list.');
  }
  const folders = (patterns: unknown[]): string[] =>
    globSync(
      patterns
        .filter((pattern): pattern is string => typeof pattern === 'string')
        .map((pattern) => `${pattern}/package.json`),
      { cwd: repository },
    )
      .map((file) => posix.dirname(file))
      .sort();

  expect(folders(packageManifest.workspaces)).toEqual(folders(workspace.packages));
});
