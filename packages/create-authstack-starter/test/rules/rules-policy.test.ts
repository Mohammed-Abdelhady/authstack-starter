import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { templateContent } from '../../scripts/sync-template.mjs';
import { prune } from '../../src/prune/index.js';
import { TOOLING_MANIFEST } from '../support/fixture.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const roots: string[] = [];
const FILES = [
  '.husky/pre-commit',
  '.husky/pre-push',
  '.husky/commit-msg',
  '.github/workflows/ci.yml',
  '.github/workflows/trusted-scan.yml',
  'scripts/ci/gates.json',
  'package.json',
  'commitlint.config.cjs',
  'scripts/guardrails/policy.mjs',
];

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-rules-policy-'));
  roots.push(root);
  for (const path of FILES) {
    const bytes = await readFile(join(REPO_ROOT, path));
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), templateContent(path, bytes));
  }
  await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('generation-time rules policy', () => {
  it('normalizes copied CRLF hook and workflow bodies to LF', async () => {
    const root = await fixture();
    for (const path of FILES.filter(
      (path) => path.startsWith('.husky/') || path.endsWith('.yml'),
    )) {
      const source = await readFile(join(root, path), 'utf8');
      await writeFile(join(root, path), source.replaceAll('\n', '\r\n'));
    }
    await prune(root, TOOLING_MANIFEST, ['email-password', 'alpha', 'beta'], [], 'strict');
    const contents = await Promise.all(
      FILES.slice(0, 5).map((path) => readFile(join(root, path), 'utf8')),
    );
    expect(contents.map((content) => content.includes('\r'))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
