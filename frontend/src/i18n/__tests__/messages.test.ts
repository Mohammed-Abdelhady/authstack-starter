import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MessageTree } from './message-tree';

// feature:locale-ar:start
/** Every ICU plural category Arabic needs. */
const ARABIC_PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
// feature:locale-ar:end

/** Matches a key at the start of a line, so values that contain quotes are left alone. */
const KEY_LINE = /^(\s*)"((?:[^"\\]|\\.)*)"(\s*):/gm;

/** Separator that cannot appear in a message key, used to make duplicate keys survive JSON.parse. */
const TAG = '@@';

function readMessages(locale: string): string {
  const filenames = [
    `${locale}.json`,
    ...[
      'pagination',
      'home',
      'nav',
      'auth',
      'toast',
      'settings',
      'errors',
      'dashboard',
      'sessions',
      'users',
      'roles',
      'permissions',
      'validation',
    ].map((topic) => `${topic}.${locale}.json`),
  ];
  const bodies = filenames.map((filename) =>
    readFileSync(fileURLToPath(new URL(`../messages/${filename}`, import.meta.url)), 'utf8')
      .trim()
      .slice(1, -1),
  );
  return `{${bodies.join(',')}}`;
}

/**
 * Parses the file with every key made unique, so sibling keys that share a name
 * both land in the tree instead of the later one silently winning.
 */
function parseWithTaggedKeys(raw: string): MessageTree {
  let index = 0;
  const tagged = raw.replace(
    KEY_LINE,
    (_match, indent: string, key: string, gap: string) =>
      `${indent}"${key}${TAG}${index++}"${gap}:`,
  );
  return JSON.parse(tagged) as MessageTree;
}

function untag(key: string): string {
  return key.split(TAG)[0];
}

function findDuplicateKeys(tree: MessageTree, prefix = ''): string[] {
  const duplicates: string[] = [];
  const seen = new Set<string>();

  for (const [taggedKey, value] of Object.entries(tree)) {
    const key = untag(taggedKey);
    if (seen.has(key)) duplicates.push(prefix + key);
    seen.add(key);
    if (typeof value === 'object') duplicates.push(...findDuplicateKeys(value, `${prefix}${key}.`));
  }

  return duplicates;
}

// feature:locale-ar:start
function flatten(tree: MessageTree, prefix = ''): Map<string, string> {
  const flat = new Map<string, string>();

  for (const [taggedKey, value] of Object.entries(tree)) {
    const path = prefix + untag(taggedKey);
    if (typeof value === 'string') {
      flat.set(path, value);
      continue;
    }
    for (const [nested, nestedValue] of flatten(value, `${path}.`)) {
      flat.set(nested, nestedValue);
    }
  }

  return flat;
}

function pluralCategoriesOf(message: string): string[] {
  const body = message.slice(message.indexOf(', plural,') + ', plural,'.length);
  return ARABIC_PLURAL_CATEGORIES.filter((category) =>
    new RegExp(`(^|[\\s{])${category}\\s*\\{`).test(body),
  );
}
// feature:locale-ar:end

const english = parseWithTaggedKeys(readMessages('en'));
const arabic = parseWithTaggedKeys(readMessages('ar')); // feature:locale-ar
const englishMessages = flatten(english); // feature:locale-ar
const arabicMessages = flatten(arabic); // feature:locale-ar

describe('locale message files', () => {
  it('has no duplicate keys', () => {
    expect(findDuplicateKeys(english)).toEqual([]);
    expect(findDuplicateKeys(arabic)).toEqual([]); // feature:locale-ar
  });

  // feature:locale-ar:start
  it('has the same keys in English and Arabic', () => {
    const englishOnly = [...englishMessages.keys()].filter((key) => !arabicMessages.has(key));
    const arabicOnly = [...arabicMessages.keys()].filter((key) => !englishMessages.has(key));

    expect(englishOnly).toEqual([]);
    expect(arabicOnly).toEqual([]);
  });

  it('answers every English ICU plural with an Arabic plural', () => {
    const missing = [...englishMessages.entries()]
      .filter(([, message]) => message.includes(', plural,'))
      .filter(([key]) => !(arabicMessages.get(key) ?? '').includes(', plural,'))
      .map(([key]) => key);

    expect(missing).toEqual([]);
  });

  it('gives every Arabic plural all six categories', () => {
    const incomplete = [...arabicMessages.entries()]
      .filter(([, message]) => message.includes(', plural,'))
      .map(([key, message]) => ({ key, categories: pluralCategoriesOf(message) }))
      .filter(({ categories }) => categories.length !== ARABIC_PLURAL_CATEGORIES.length);

    expect(incomplete).toEqual([]);
  });
  // feature:locale-ar:end
});
