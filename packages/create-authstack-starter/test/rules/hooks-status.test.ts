import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readHookStatus } from '../../src/scaffold/hooks-status.js';
import { git, isolatedGit } from '../support/answers-helpers.js';

const roots: string[] = [];
const original = { ...process.env };
afterEach(async () => {
  process.env = { ...original };
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-hook-state-'));
  roots.push(root);
  process.env = isolatedGit(root).env;
  git(['init', '--initial-branch=test', root], root, process.env);
  return root;
}

it('requires the generated project itself to own the repository', async () => {
  const root = await fixture();
  const child = join(root, 'nested-project');
  await mkdir(child);
  expect(await readHookStatus(child)).toEqual({ ownRepository: false, active: false });
});

it('reports an own repository without configured hooks as inactive', async () => {
  const root = await fixture();
  expect(await readHookStatus(root)).toEqual({ ownRepository: true, active: false });
});

it.each(['runner', 'wrapper', 'executable', 'body', 'complete'])(
  'requires hook runner, executable wrappers and bodies for %s',
  async (missing) => {
    const root = await fixture();
    await mkdir(join(root, '.husky/_'), { recursive: true });
    git(['config', '--local', 'core.hooksPath', '.husky/_'], root, process.env);
    if (missing !== 'runner') await writeFile(join(root, '.husky/_/h'), '#!/bin/sh\n');
    for (const hook of ['pre-commit', 'commit-msg', 'pre-push']) {
      if (missing !== 'body' || hook !== 'pre-push')
        await writeFile(join(root, '.husky', hook), '#!/bin/sh\n');
      if (missing === 'wrapper' && hook === 'pre-push') continue;
      await writeFile(join(root, '.husky/_', hook), '#!/bin/sh\n');
      await chmod(
        join(root, '.husky/_', hook),
        missing === 'executable' && hook === 'pre-push' ? 0o644 : 0o755,
      );
    }
    expect(await readHookStatus(root)).toEqual({
      ownRepository: true,
      active: missing === 'complete',
    });
  },
);
