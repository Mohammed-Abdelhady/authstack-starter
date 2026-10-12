import assert from 'node:assert/strict';
import test from 'node:test';
import { busyPairs, loadBusyPairs, resolveBusyLook } from './check-contrast.busy.mjs';
import { loadCss, pairRatio, parseTokens } from './check-contrast.mjs';

const BUSY_SOURCE = `
export const BUSY_PRESS_CLASSES = 'aria-disabled:cursor-progress aria-disabled:opacity-85';
export const BUSY_FIELD_CLASSES =
  'aria-disabled:cursor-progress aria-disabled:text-muted-foreground';
`;

test('the busy look is read from the classes the primitives use', () => {
  assert.deepEqual(resolveBusyLook(BUSY_SOURCE), {
    pressOpacity: 0.85,
    fieldText: 'muted-foreground',
  });
  assert.equal(
    resolveBusyLook(BUSY_SOURCE.replace(' aria-disabled:opacity-85', '')).pressOpacity,
    1,
  );
});

test('a busy field that is given an opacity, or no text colour, is refused', () => {
  const dimmed = BUSY_SOURCE.replace(
    'aria-disabled:text-muted-foreground',
    'aria-disabled:opacity-50',
  );
  assert.throws(() => resolveBusyLook(dimmed), /no opacity/);
  const plain = BUSY_SOURCE.replace(' aria-disabled:text-muted-foreground', '');
  assert.throws(() => resolveBusyLook(plain), /text colour token/);
});

test('a toned down control blends its text and its fill with the page behind it', () => {
  const tokens = { ink: [0, 0, 0], paper: [0, 0, 100] };
  // White on black at half strength over white: white on mid grey.
  const halved = { token: 'paper', background: 'ink', opacity: 0.5, page: 'paper' };
  assert.equal(pairRatio(halved, tokens, 'light').toFixed(2), '3.98');
  assert.equal(pairRatio({ ...halved, page: 'missing' }, tokens, 'light'), null);
});

test('busy buttons and fields meet their minimum, and the half strength they had did not', () => {
  const themes = parseTokens(loadCss());
  const short = (pairs, theme) =>
    pairs
      .filter((pair) => pairRatio(pair, themes[theme], theme) < pair.target)
      .map((pair) => pair.part);

  for (const theme of ['light', 'dark']) assert.deepEqual(short(loadBusyPairs(), theme), []);
  // Measured in a browser at half strength: 2.66 to 2.70 in light, 2.40 to 2.51 in dark.
  const [halved] = busyPairs({ pressOpacity: 0.5, fieldText: 'muted-foreground' });
  const ratio = pairRatio(halved, themes.light, 'light');
  assert.ok(ratio > 2.6 && ratio < 2.8, `half strength gave ${ratio}`);
});
