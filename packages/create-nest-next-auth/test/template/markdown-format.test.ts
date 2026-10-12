import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, getFileInfo, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';
import { databaseMarkerIds } from '../../src/manifest/dimensions.js';
import { loadManifest } from '../../src/manifest/load.js';
import { stripDocMarkers } from '../../src/prune/doc-markers.js';
import { REPO_ROOT } from '../support/combination-helpers.js';

const MARKER_TEXT = /<!--\s*feature:/;
const FENCE = /^\s*(?:`{3,}|~{3,})/;
const ROW = /^\s*\|/;
const UNESCAPED_PIPE = /(?<!\\)\|/g;

const manifest = await loadManifest(REPO_ROOT);
const known = new Set([
  ...Object.keys(manifest.features),
  ...Object.keys(manifest.options),
  ...Object.keys(manifest.targets),
  ...Object.keys(manifest.shared),
  ...databaseMarkerIds(manifest),
]);

// The installer package is not part of a generated project, so nothing strips it.
const tracked = execFileSync('git', ['ls-files', '-z', '--', '*.md'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
})
  .split('\0')
  .filter((file) => file !== '' && !file.startsWith('packages/'));

// Prettier skips what `.prettierignore` lists when the commit hook runs it.
const files: string[] = [];
for (const file of tracked) {
  const info = await getFileInfo(join(REPO_ROOT, file), {
    ignorePath: join(REPO_ROOT, '.prettierignore'),
  });
  if (!info.ignored) files.push(file);
}

/** The content the commit hook leaves: `prettier --write` with the repository config. */
async function formatted(file: string): Promise<string> {
  const path = join(REPO_ROOT, file);
  const config = await resolveConfig(path);
  return format(readFileSync(path, 'utf8'), { ...config, filepath: path });
}

function outsideFences(content: string): string[] {
  let fenced = false;
  return content.split('\n').filter((line) => {
    if (FENCE.test(line)) {
      fenced = !fenced;
      return false;
    }
    return !fenced;
  });
}

/** Rows whose pipe count differs from the row above them in the same table. */
function raggedRows(content: string): string[] {
  const lines = outsideFences(content);
  return lines.filter((line, index) => {
    const above = lines[index - 1] ?? '';
    if (!ROW.test(line) || !ROW.test(above)) return false;
    return line.match(UNESCAPED_PIPE)?.length !== above.match(UNESCAPED_PIPE)?.length;
  });
}

describe('the Markdown the installer strips', () => {
  it('includes the files that carry markers', () => {
    expect(files).toContain('README.md');
    expect(files).toContain('docs/reference/ARCHITECTURE.md');
    expect(files).toContain('backend/README.md');
  });

  it.each(files)('%s is already in the shape the commit hook writes', async (file) => {
    expect(await formatted(file)).toBe(readFileSync(join(REPO_ROOT, file), 'utf8'));
  });

  it.each([
    ['everything selected', known],
    ['nothing selected', new Set<string>()],
  ])('%s: every formatted file generates a clean document', async (_name, kept) => {
    for (const file of files) {
      const { content } = stripDocMarkers(await formatted(file), file, kept, known);
      expect(outsideFences(content).filter((line) => MARKER_TEXT.test(line))).toEqual([]);
      expect(raggedRows(content)).toEqual([]);
    }
  });
});
