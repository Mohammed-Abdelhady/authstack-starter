import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pruneDependabot } from '../../src/prune/dependabot.js';

const FULL = [
  '# Managed by hand',
  'version: 2',
  'updates:',
  '  - package-ecosystem: npm',
  "    directory: '/'",
  '    schedule:',
  '      interval: weekly',
  '',
  '  - package-ecosystem: docker',
  '    directory: /backend',
  '    schedule:',
  '      interval: weekly',
  '',
  '  - package-ecosystem: docker',
  '    directory: /nginx',
  '    schedule:',
  '      interval: weekly',
  '',
].join('\n');

const WITHOUT_BACKEND = [
  '# Managed by hand',
  'version: 2',
  'updates:',
  '  - package-ecosystem: npm',
  "    directory: '/'",
  '    schedule:',
  '      interval: weekly',
  '',
  '  - package-ecosystem: docker',
  '    directory: /nginx',
  '    schedule:',
  '      interval: weekly',
  '',
].join('\n');

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-dependabot-'));
  roots.push(root);
  await mkdir(join(root, '.github'), { recursive: true });
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('pruneDependabot', () => {
  it('removes only the entry whose Dockerfile was deleted, preserving the rest', async () => {
    const root = await tempRoot();
    await writeFile(join(root, '.github/dependabot.yml'), FULL, 'utf8');

    await expect(pruneDependabot(root, ['backend/Dockerfile'])).resolves.toBe(true);

    expect(await readFile(join(root, '.github/dependabot.yml'), 'utf8')).toBe(WITHOUT_BACKEND);
  });

  it('returns false and leaves the file byte for byte alone when nothing is deleted', async () => {
    const root = await tempRoot();
    await writeFile(join(root, '.github/dependabot.yml'), FULL, 'utf8');

    await expect(pruneDependabot(root, [])).resolves.toBe(false);
    expect(await readFile(join(root, '.github/dependabot.yml'), 'utf8')).toBe(FULL);
  });

  it('returns false for a missing file', async () => {
    const root = await tempRoot();

    await expect(pruneDependabot(root, ['backend/Dockerfile'])).resolves.toBe(false);
  });

  it('removes a root-level docker entry when the root Dockerfile is deleted', async () => {
    const root = await tempRoot();
    const content = [
      'version: 2',
      'updates:',
      '  - package-ecosystem: docker',
      '    directory: /',
      '    schedule:',
      '      interval: weekly',
      '',
    ].join('\n');
    await writeFile(join(root, '.github/dependabot.yml'), content, 'utf8');

    await expect(pruneDependabot(root, ['Dockerfile'])).resolves.toBe(true);

    expect(await readFile(join(root, '.github/dependabot.yml'), 'utf8')).toBe(
      'version: 2\nupdates: []\n',
    );
  });

  it('rejects invalid YAML with the file name', async () => {
    const root = await tempRoot();
    await writeFile(join(root, '.github/dependabot.yml'), 'updates: [\n', 'utf8');

    await expect(pruneDependabot(root, [])).rejects.toThrow(
      /Could not parse \.github\/dependabot\.yml/,
    );
  });
});
