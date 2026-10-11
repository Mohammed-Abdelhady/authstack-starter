import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { LOCALE_AR_OPTION_ID } from '../../src/constants/index.js';
import { loadManifest } from '../../src/manifest/load.js';
import { listFiles } from '../../src/utils/fs.js';
import {
  ARABIC_FORBIDDEN,
  arabicLeftBehind,
  DOCKER_FORBIDDEN,
  findForbiddenContent,
  LEGACY_PACKAGE_MANAGER_COMMANDS,
  PRODUCTION_FORBIDDEN,
} from '../support/reference-content.js';

const roots: string[] = [];

async function tree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-content-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('findForbiddenContent', () => {
  it('finds a planted docker reference and ignores node_modules and lockfiles', async () => {
    const root = await tree({
      'note.md': 'Run docker compose up.\n',
      'node_modules/ignored.md': 'nginx\n',
      'pnpm-lock.yaml': 'docker-compose\n',
    });

    expect(findForbiddenContent(root, DOCKER_FORBIDDEN)).toEqual(['note.md']);
  });

  it('matches the production patterns case-insensitively', async () => {
    const root = await tree({ 'deploy.md': 'The Nginx edge and docker-compose.prod.\n' });

    expect(findForbiddenContent(root, PRODUCTION_FORBIDDEN)).toEqual(['deploy.md']);
  });

  it('finds each planted docker leftover', async () => {
    const root = await tree({
      'a.txt': 'pnpm run setup:prod\n',
      'b.txt': 'node scripts/verify-docker.mjs\n',
      'c.txt': 'See docs/operations/deployment.md.\n',
      'd.txt': 'The word nginx alone.\n',
    });

    expect(findForbiddenContent(root, DOCKER_FORBIDDEN).sort()).toEqual([
      'a.txt',
      'b.txt',
      'c.txt',
      'd.txt',
    ]);
  });

  it('finds each planted Arabic leftover', async () => {
    const root = await tree({
      'a.ts': "const locale = 'ar';\n",
      'b.md': 'This mentions Arabic.\n',
      'c.json': '{ "note": "messages/ar.json" }\n',
      'd.ts': "const header = 'ar;q=0';\n",
      'e.tsx': 'return switchToArabic(fallback);\n',
    });

    expect(findForbiddenContent(root, ARABIC_FORBIDDEN).sort()).toEqual([
      'a.ts',
      'b.md',
      'c.json',
      'd.ts',
      'e.tsx',
    ]);
  });

  it('returns nothing for a clean tree', async () => {
    const root = await tree({ 'README.md': '# Project\n' });

    expect(findForbiddenContent(root, DOCKER_FORBIDDEN)).toEqual([]);
  });

  it('finds npm, yarn, and bun commands in generated instruction text', async () => {
    const oldNpm = 'n' + 'pm';
    const oldYarn = 'y' + 'arn';
    const oldBun = 'b' + 'un';
    const root = await tree({
      'npm.md': `${oldNpm} run lint\n`,
      'yarn.md': `${oldYarn} install\n`,
      'bun.md': `${oldBun} run lint\n`,
    });

    expect(findForbiddenContent(root, LEGACY_PACKAGE_MANAGER_COMMANDS)).toEqual([
      'bun.md',
      'npm.md',
      'yarn.md',
    ]);
  });
});

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const FRONTEND_SOURCE = 'frontend/src';
const MOBILE_SOURCE = 'mobile';
const ARABIC_NAME = '\u0644\u064a\u0644\u0649';

describe('website and mobile code a project without Arabic keeps', () => {
  it('reports Arabic content on lines that are not marked for the Arabic option', () => {
    const left = arabicLeftBehind(
      new Map([
        ['frontend/src/a.test.tsx', "describe.each(['en', 'ar'] as const)('in %s', run);\n"],
        ['frontend/src/b.test.tsx', "async function open(locale: 'en' | 'ar') {}\n"],
        ['frontend/src/c.test.tsx', `const NAMES = ['Layla', '${ARABIC_NAME}'];\n`],
        ['frontend/src/d.ts', '/** Holds Latin or Arabic text. */\nexport const D = 1;\n'],
        ['frontend/src/e.test.tsx', "const locale = 'ar'; // feature:passkeys\n"],
        ['frontend/src/f.test.tsx', "import ar from '@/i18n/messages/ar.json';\n"],
      ]),
      [],
    );

    expect(left).toEqual([
      'frontend/src/a.test.tsx',
      'frontend/src/b.test.tsx',
      'frontend/src/c.test.tsx',
      'frontend/src/d.ts',
      'frontend/src/e.test.tsx',
      'frontend/src/f.test.tsx',
    ]);
  });

  it('accepts marked lines, marked blocks and files the project loses', () => {
    const left = arabicLeftBehind(
      new Map([
        [
          'frontend/src/line.test.tsx',
          "describe.each([\n  'en',\n  'ar', // feature:locale-ar\n] as const)('in %s', run);\n",
        ],
        [
          'frontend/src/block.test.tsx',
          `// feature:locale-ar:start\nconst NAME = '${ARABIC_NAME}';\n// feature:locale-ar:end\nconst dir = 'rtl';\n`,
        ],
        ['frontend/src/components/LanguageSwitcher.tsx', "const next = 'ar';\n"],
        ['frontend/e2e/locale.spec.ts', "test.use({ appLocale: 'ar' });\n"],
        ['frontend/src/i18n/messages/en.json', '{ "switchToArabic": "Switch to Arabic" }\n'],
      ]),
      ['frontend/src/components/LanguageSwitcher.tsx', 'frontend/e2e/**'],
    );

    expect(left).toEqual([]);
  });

  it.each([FRONTEND_SOURCE, MOBILE_SOURCE])(
    'finds none in %s of this repository',
    async (source) => {
      const manifest = await loadManifest(REPO_ROOT);
      const files = new Map<string, string>();
      for (const file of await listFiles(join(REPO_ROOT, source))) {
        const path = `${source}/${file}`;
        files.set(path, await readFile(join(REPO_ROOT, path), 'utf8'));
      }
      // An empty folder would pass without reading anything.
      expect(files.size).toBeGreaterThan(100);

      expect(
        arabicLeftBehind(files, [
          ...manifest.core.alwaysRemoveFiles,
          ...manifest.options[LOCALE_AR_OPTION_ID].files,
        ]),
      ).toEqual([]);
    },
  );
});
