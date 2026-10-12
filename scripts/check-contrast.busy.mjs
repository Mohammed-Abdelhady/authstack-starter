import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUSY_SOURCE = 'frontend/src/components/ui/busy.ts';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TEXT_MINIMUM = 4.5;
const BORDER_MINIMUM = 3.0;

// The fills a busy button can have, and the surfaces a control sits on.
const BUTTON_FILLS = [
  ['primary-foreground', 'primary'],
  ['destructive-foreground', 'destructive'],
  ['secondary-foreground', 'secondary'],
  ['foreground', 'background'],
];
const PAGES = ['background', 'card'];

function classesOf(source, constant) {
  const match = new RegExp(`${constant}\\s*=\\s*'([^']*)'`).exec(source);
  if (!match) throw new Error(`${constant} needs a literal class string in ${BUSY_SOURCE}`);
  return match[1].split(/\s+/);
}

/**
 * How a busy control looks, read from the classes the primitives use: the
 * opacity of a busy button and the text colour of a busy field. A field that
 * is given an opacity cannot be audited: its border has no contrast to spare.
 */
export function resolveBusyLook(source) {
  const press = classesOf(source, 'BUSY_PRESS_CLASSES');
  const field = classesOf(source, 'BUSY_FIELD_CLASSES');
  const opacity = press.map((name) => /^aria-disabled:opacity-(\d+)$/.exec(name)?.[1]).find(Boolean);
  const fieldText = field.map((name) => /^aria-disabled:text-([a-z0-9-]+)$/.exec(name)?.[1]).find(Boolean);

  if (field.some((name) => name.includes('opacity-'))) {
    throw new Error('a busy field must keep its border at full strength: no opacity');
  }
  if (!fieldText) throw new Error('a busy field needs a text colour token');
  return { pressOpacity: opacity === undefined ? 1 : Number.parseInt(opacity, 10) / 100, fieldText };
}

/** Busy button text on its fill, busy field text on the field, and the field border. */
export function busyPairs({ pressOpacity, fieldText }) {
  return [
    ...PAGES.flatMap((page) =>
      BUTTON_FILLS.map(([token, background]) => ({
        token,
        background,
        opacity: pressOpacity,
        page,
        target: TEXT_MINIMUM,
        part: `busy button on ${page}`,
      })),
    ),
    { token: fieldText, background: 'background', target: TEXT_MINIMUM, part: 'busy field text' },
    ...PAGES.map((page) => ({
      token: 'input',
      background: page,
      target: BORDER_MINIMUM,
      part: `busy field border on ${page}`,
    })),
  ];
}

export function loadBusyPairs() {
  return busyPairs(resolveBusyLook(fs.readFileSync(path.resolve(ROOT, BUSY_SOURCE), 'utf8')));
}
