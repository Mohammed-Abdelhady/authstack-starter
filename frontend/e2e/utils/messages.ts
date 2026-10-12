import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppLocale } from './auth-actions';

const CATALOGUES = resolve(__dirname, '../../src/i18n/messages');

type Tree = { [key: string]: Tree | string };

function isTree(value: unknown): value is Tree {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function merge(base: Tree, overlay: Tree): Tree {
  const merged: Tree = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = merged[key];
    merged[key] = isTree(value) && isTree(existing) ? merge(existing, value) : value;
  }
  return merged;
}

const loaded = new Map<AppLocale, Tree>();

/** Every catalogue file of a locale, merged the way the app merges them. */
function catalogue(locale: AppLocale): Tree {
  const known = loaded.get(locale);
  if (known) return known;
  const files = readdirSync(CATALOGUES)
    .filter((file) => file === `${locale}.json` || file.endsWith(`.${locale}.json`))
    // The base file first, so the smaller files lay over it.
    .sort((a, b) => Number(b === `${locale}.json`) - Number(a === `${locale}.json`));
  const tree = files.reduce<Tree>((merged, file) => {
    const parsed: unknown = JSON.parse(readFileSync(resolve(CATALOGUES, file), 'utf8'));
    return isTree(parsed) ? merge(merged, parsed) : merged;
  }, {});
  loaded.set(locale, tree);
  return tree;
}

/**
 * A catalogue message by its key, so a spec follows a rewording and fails on
 * a missing key. `values` fill plain `{name}` arguments.
 */
export function message(
  locale: AppLocale,
  key: string,
  values: Record<string, string> = {},
): string {
  let node: Tree | string | undefined = catalogue(locale);
  for (const part of key.split('.')) {
    node = isTree(node) ? node[part] : undefined;
  }
  if (typeof node !== 'string') throw new Error(`no ${locale} message for "${key}"`);
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    node,
  );
}
