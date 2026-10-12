import * as filesystem from 'node:fs/promises';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { findDanglingReferences } from '../../src/prune/references.js';
import { prune } from '../../src/prune/index.js';
import { createFixtureTree, FIXTURE_MANIFEST } from '../support/fixture.js';

vi.mock('node:fs/promises', { spy: true });

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it('reports missing inline and reference links with source locations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cna-markdown-'));
  roots.push(root);
  await mkdir(join(root, 'docs'));
  await writeFile(
    join(root, 'docs/guide.md'),
    [
      'See [Inline](./missing.md#help) and [Full][missing].',
      'See [missing][] and [missing].',
      '[missing]: <../removed.md> "Title"',
    ].join('\n'),
  );
  expect(await findDanglingReferences(root, [])).toEqual([
    { file: 'docs/guide.md', line: 1, specifier: './missing.md#help', target: 'docs/missing.md' },
    { file: 'docs/guide.md', line: 1, specifier: '<../removed.md>', target: 'removed.md' },
    { file: 'docs/guide.md', line: 2, specifier: '<../removed.md>', target: 'removed.md' },
    { file: 'docs/guide.md', line: 2, specifier: '<../removed.md>', target: 'removed.md' },
  ]);
});

it('ignores anchors, remote links, absolute paths, fences and live targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cna-markdown-'));
  roots.push(root);
  await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'docs/kept.md'), '# Kept');
  await writeFile(
    join(root, 'README.md'),
    [
      '[Anchor](#missing) [Web](https://example.com/missing) [Mail](mailto:a@example.com)',
      '[Absolute](/missing.md) [Remote](//example.com/missing) [Live](docs/kept.md?view=1#help)',
      '[Directory](docs/) [Empty]()',
      '````md',
      '[Missing](missing.md)',
      '```',
      '[Also missing](other.md)',
      '````',
      '~~~md',
      '[missing]: missing.md',
      '[missing]',
      '~~~',
    ].join('\n'),
  );
  expect(await findDanglingReferences(root, [])).toEqual([]);
});

it('keeps a prose reference reportable after its feature guide is removed', async () => {
  const root = await createFixtureTree();
  roots.push(root);
  await writeFile(join(root, 'docs/prose.md'), 'See [Beta][beta].\n[beta]: setup-beta.md\n');
  const result = await prune(root, FIXTURE_MANIFEST, ['email-password', 'alpha'], []);
  expect(result.dangling).toEqual([
    { file: 'docs/prose.md', line: 1, specifier: 'setup-beta.md', target: 'docs/setup-beta.md' },
  ]);
});

it.each(['absolute', 'relative'])(
  'rejects external Markdown targets with a %s root',
  async (kind) => {
    const workspace = await mkdtemp(join(tmpdir(), 'cna-markdown-boundary-'));
    roots.push(workspace);
    const root = join(workspace, 'project');
    await mkdir(join(root, 'docs'), { recursive: true });
    await mkdir(join(workspace, 'other'));
    await mkdir(join(workspace, 'project-neighbor'));
    await writeFile(join(workspace, 'other/file.md'), '# Outside');
    await writeFile(join(workspace, 'project-neighbor/file.md'), '# Also outside');
    await writeFile(join(root, 'kept.md'), '# Inside');
    await writeFile(
      join(root, 'docs/guide.md'),
      [
        '[Outside](../../other/file.md)',
        '[Sibling prefix](../../project-neighbor/file.md)',
        '[Inside](../docs/../kept.md)',
      ].join('\n'),
    );

    const projectRoot = kind === 'relative' ? relative(process.cwd(), root) : root;
    expect(await findDanglingReferences(projectRoot, [])).toEqual([
      {
        file: 'docs/guide.md',
        line: 1,
        specifier: '../../other/file.md',
        target: '../other/file.md',
      },
      {
        file: 'docs/guide.md',
        line: 2,
        specifier: '../../project-neighbor/file.md',
        target: '../project-neighbor/file.md',
      },
    ]);
  },
);

it('reports an escaping target without consulting the filesystem boundary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cna-markdown-no-stat-'));
  roots.push(root);
  await writeFile(join(root, 'README.md'), '[Outside](../other/file.md)');
  const blocked = vi.mocked(filesystem.stat).mockRejectedValue(new Error('Outside stat forbidden'));
  try {
    await expect(findDanglingReferences(root, [])).resolves.toEqual([
      { file: 'README.md', line: 1, specifier: '../other/file.md', target: '../other/file.md' },
    ]);
  } finally {
    blocked.mockRestore();
  }
});
