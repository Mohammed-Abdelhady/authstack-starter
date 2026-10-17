import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const EXCEPTION_KEY = /^["']?minimumReleaseAgeExclude["']?\s*:(.*)$/;
const STRICT_KEY = /^["']?minimumReleaseAgeStrict["']?\s*:\s*true\s*(#.*)?$/m;
const AGE_KEY = /^["']?minimumReleaseAge["']?\s*:\s*(\d+)\s*(#.*)?$/m;
const LIST_ITEM = /^\s*-\s+/;
const BLANK_OR_COMMENT = /^\s*(#.*)?$/;
const unquote = (item) =>
  item
    .trim()
    .replace(/\s+#.*$/, '')
    .replace(/^["']|["']$/g, '');

/** Every package the workspace file lets through the cooldown. None is expected. */
export function releaseAgeExceptions(source) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => EXCEPTION_KEY.test(line));
  if (start === -1) return [];
  const inline = lines[start].match(EXCEPTION_KEY)[1].trim();
  const items = inline.startsWith('[') ? inline.slice(1, inline.lastIndexOf(']')).split(',') : [];
  for (const line of lines.slice(start + 1)) {
    if (LIST_ITEM.test(line)) items.push(line.replace(LIST_ITEM, ''));
    else if (!BLANK_OR_COMMENT.test(line)) break;
  }
  return items.map(unquote).filter(Boolean);
}

/** The cooldown in minutes the workspace file sets, or undefined when it leaves it to pnpm. */
export function releaseAgeMinutes(source) {
  const match = source.match(AGE_KEY);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

const workspaceFile = () => readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8');

test('the workspace file lets no package skip the release-age cooldown', () => {
  assert.deepEqual(releaseAgeExceptions(workspaceFile()), []);
});

test('the workspace file sets strict release-age mode and a 1440 minute cooldown', () => {
  assert.equal(STRICT_KEY.test(workspaceFile()), true);
  assert.equal(releaseAgeMinutes(workspaceFile()), 1440);
});
