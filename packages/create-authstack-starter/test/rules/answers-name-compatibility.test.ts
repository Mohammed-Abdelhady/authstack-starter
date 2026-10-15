import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { recordAnswers, readAnswersRecord } from '../../src/scaffold/answers.js';
import type { AnswersRecord } from '../../src/types.js';

const CURRENT_FILE = '.create-authstack-starter.json';
const LEGACY_FILE = '.create-nest-next-auth.json';
const RECORD: AnswersRecord = {
  schemaVersion: 4,
  packageManager: 'pnpm@12.6.0',
  rules: { policy: 'strict' },
  installer: { name: 'create-authstack-starter', version: '0.1.0' },
  template: { sha256: 'a'.repeat(64), commit: null },
  answers: { targets: ['web'], database: 'mongodb', features: [], options: [], locales: ['en'] },
};
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'answers-name-'));
  roots.push(root);
  return root;
}

it('writes the new filename and crosses the real writer-reader handoff', async () => {
  const root = await fixture();
  await recordAnswers(root, RECORD);
  expect(JSON.parse(await readFile(join(root, CURRENT_FILE), 'utf8'))).toEqual(RECORD);
  expect(await readAnswersRecord(root)).toEqual(RECORD);
  await expect(readFile(join(root, LEGACY_FILE))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('reads a legacy filename without changing the recorded installer', async () => {
  const root = await fixture();
  const legacy = { ...RECORD, installer: { name: 'create-nest-next-auth', version: '0.1.0' } };
  await writeFile(join(root, LEGACY_FILE), JSON.stringify(legacy));
  expect(await readAnswersRecord(root)).toEqual(legacy);
  await expect(readFile(join(root, CURRENT_FILE))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('prefers the current file when both filenames exist', async () => {
  const root = await fixture();
  await writeFile(
    join(root, LEGACY_FILE),
    JSON.stringify({ ...RECORD, rules: { policy: 'standard' } }),
  );
  await writeFile(join(root, CURRENT_FILE), JSON.stringify(RECORD));
  expect(await readAnswersRecord(root)).toEqual(RECORD);
});

it.each(['json', 'schema', 'directory'] as const)(
  'does not mask an invalid current %s with a valid legacy record',
  async (kind) => {
    const root = await fixture();
    await writeFile(join(root, LEGACY_FILE), JSON.stringify(RECORD));
    if (kind === 'directory') await mkdir(join(root, CURRENT_FILE));
    else await writeFile(join(root, CURRENT_FILE), kind === 'json' ? '{' : 'null');
    await expect(readAnswersRecord(root)).rejects.toThrow();
  },
);

it('rejects when neither filename exists', async () => {
  await expect(readAnswersRecord(await fixture())).rejects.toMatchObject({ code: 'ENOENT' });
});
