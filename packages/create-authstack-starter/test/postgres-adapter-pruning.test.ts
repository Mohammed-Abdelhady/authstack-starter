import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { isRecord } from '../src/manifest/read.js';
import { stripFeatureMarkers } from '../src/prune/markers.js';
import { listFiles } from '../src/utils/fs.js';
import { matchesAnyGlob } from '../src/utils/glob.js';

const REPOSITORY = fileURLToPath(new URL('../../../', import.meta.url));
const BACKEND_SOURCES = /^backend\/(?:src|test)\/.*\.(?:ts|mts|mjs)$/;

async function alwaysRemoved(): Promise<string[]> {
  const manifest: unknown = JSON.parse(
    await readFile(join(REPOSITORY, 'template.manifest.json'), 'utf8'),
  );
  if (!isRecord(manifest) || !isRecord(manifest.core)) throw new Error('manifest has no core');
  const globs: unknown = manifest.core.alwaysRemoveFiles;
  if (!Array.isArray(globs)) throw new Error('manifest has no alwaysRemoveFiles');
  return globs.filter((glob): glob is string => typeof glob === 'string');
}

// A module loaded by a computed path is invisible to the check for imports
// into removed files, so a spec that loads optional or PostgreSQL files that
// way would ship and fail in every generated project.
const COMPUTED_LOAD = /\b(?:requireActual|requireMock|require|import)\(\s*[^'"`\s)]/;

it('ships no backend file that loads a module by a computed path', async () => {
  expect(
    [
      'require(modulePath)',
      'jest.requireActual(modulePath)',
      'jest.requireMock(modulePath)',
      'import(modulePath)',
      "require('./module.js')",
      "import('./module.js')",
    ].map((source) => COMPUTED_LOAD.test(source)),
  ).toEqual([true, true, true, true, false, false]);

  const removed = await alwaysRemoved();
  const sources = (await listFiles(join(REPOSITORY, 'backend')))
    .map((file) => `backend/${file}`)
    .filter((file) => BACKEND_SOURCES.test(file));

  const computed: string[] = [];
  for (const file of sources) {
    if (COMPUTED_LOAD.test(await readFile(join(REPOSITORY, file), 'utf8'))) computed.push(file);
  }

  expect(computed.filter((file) => !matchesAnyGlob(file, removed))).toEqual([]);
});

const NEUTRAL_FILES = [
  'backend/src/admin/persistence/admin-persistence.ts',
  'backend/src/auth/magic-link/persistence/magic-link-persistence.ts',
  'backend/src/auth/oauth/persistence/oauth-persistence.ts',
  'backend/src/auth/passkeys/persistence/passkeys-persistence.ts',
  'backend/src/auth/persistence/auth-persistence.ts',
  'backend/src/auth/two-factor/persistence/two-factor-persistence.ts',
  'backend/src/common/persistence/common-persistence.ts',
  'backend/src/database/seeds/persistence/seed-persistence.ts',
  'backend/src/health/persistence/health-persistence.ts',
  'backend/src/role/persistence/role-persistence.ts',
  'backend/src/session/native/persistence/native-oauth-persistence.ts',
  'backend/src/session/persistence/session-persistence.ts',
  'backend/src/user/persistence/user-persistence.ts',
];
const COMMENT_LINE = /^\s*(?:\/\/|\*|\/\*)/;
const CLOSING_LINE = /^\s*[\])}]/;

it('leaves nothing of PostgreSQL in a neutral persistence file once its lines are removed', async () => {
  const leftovers: string[] = [];
  for (const file of NEUTRAL_FILES) {
    const source = await readFile(join(REPOSITORY, file), 'utf8');
    const { content } = stripFeatureMarkers(
      source,
      file,
      new Set(['mongodb']),
      new Set(['mongodb', 'postgres', 'database-choice']),
    );
    const lines = content.split('\n');
    lines.forEach((line, index) => {
      const next = lines[index + 1] ?? '';
      // A comment directly above a closing bracket described a line that is gone.
      const orphan = COMMENT_LINE.test(line) && !line.includes('*/') && CLOSING_LINE.test(next);
      if (/postgres/i.test(line) || orphan) leftovers.push(`${file}:${index + 1} ${line.trim()}`);
    });
  }

  expect(leftovers).toEqual([]);
});
