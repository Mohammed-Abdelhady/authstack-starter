import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatChangedFiles } from '../../src/prune/format.js';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-format-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('formatChangedFiles', () => {
  it('rethrows a prettier failure with the file path', async () => {
    const root = await tempRoot();
    await writeFile(join(root, 'bad.ts'), 'const x = {\n', 'utf8');

    await expect(formatChangedFiles(root, ['bad.ts'])).rejects.toThrow(/Could not format bad\.ts/);
  });
});
