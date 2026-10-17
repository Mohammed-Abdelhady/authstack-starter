import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { copyTemplate } from '../../src/scaffold/copy.js';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-copy-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('copyTemplate', () => {
  it('refuses a symbolic-link template', async () => {
    const root = await tempRoot();
    const source = join(root, 'template');
    await mkdir(source, { recursive: true });
    const link = join(root, 'link');
    await symlink(source, link, 'dir');

    await expect(copyTemplate(link, join(root, 'target'))).rejects.toThrow(/symbolic link/);
  });
});
