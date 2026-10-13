import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { removeDocLinks } from '../../src/prune/docs.js';

let root = '';

afterEach(async () => {
  if (root !== '') await rm(root, { recursive: true, force: true });
});

async function fixture(content: string): Promise<void> {
  root = await mkdtemp(join(tmpdir(), 'cna-doc-links-'));
  await writeFile(join(root, 'README.md'), content, 'utf8');
}

it('removes numbered items and reference definitions for deleted documents', async () => {
  await fixture(
    '1. [API][api]\n[api]: docs/removed.md\n2. [Guide](docs/kept.md)\n3) [Old guide](docs/removed.md)\n',
  );

  const result = await removeDocLinks(root, ['docs/removed.md']);

  expect(result.removedLines).toBe(3);
  expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('2. [Guide](docs/kept.md)\n');
});

it('keeps a list row and its live link when another target was deleted', async () => {
  await fixture('- [SMTP](docs/setup/setup-smtp.md) | [Deploy](docs/operations/deployment.md)\n');

  const result = await removeDocLinks(root, ['docs/setup/setup-smtp.md']);

  expect(result.removedLines).toBe(0);
  expect(await readFile(join(root, 'README.md'), 'utf8')).toBe(
    '- SMTP | [Deploy](docs/operations/deployment.md)\n',
  );
});

it('keeps links when a filename appears only as link text or in a different target', async () => {
  await fixture('- [Fix for setup-smtp.md](docs/other.md)\n1. [Archive](archive/setup-smtp.md)\n');

  const result = await removeDocLinks(root, ['docs/setup/setup-smtp.md']);

  expect(result.removedLines).toBe(0);
  expect(await readFile(join(root, 'README.md'), 'utf8')).toBe(
    '- [Fix for setup-smtp.md](docs/other.md)\n1. [Archive](archive/setup-smtp.md)\n',
  );
});

it.each([
  [
    'backtick fences',
    '````markdown\n- [Removed](docs/removed.md)\n```\n- [Still fenced](docs/removed.md)\n````\n',
    '````markdown\n- [Removed](docs/removed.md)\n```\n- [Still fenced](docs/removed.md)\n````\n',
  ],
  [
    'tilde fences',
    '~~~markdown\n1. [Removed](docs/removed.md)\n~~~\n',
    '~~~markdown\n1. [Removed](docs/removed.md)\n~~~\n',
  ],
  [
    'reference definition fences',
    '~~~markdown\n[removed]: docs/removed.md\n~~~\n- [Example][removed]\n',
    '~~~markdown\n[removed]: docs/removed.md\n~~~\n- [Example][removed]\n',
  ],
])('leaves removed-file links inside %s unchanged', async (_name, content, expected) => {
  await fixture(content);

  const result = await removeDocLinks(root, ['docs/removed.md']);

  expect(result.removedLines).toBe(0);
  expect(await readFile(join(root, 'README.md'), 'utf8')).toBe(expected);
});
