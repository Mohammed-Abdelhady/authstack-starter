import assert from 'node:assert/strict';
import test from 'node:test';
import { compositeOver, contrastRatio, pairRatio } from './contrast-math.mjs';

const GREYS = { ink: [0, 0, 0], paper: [0, 0, 100] };
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const ratio = (first, second) => contrastRatio(first, second).toFixed(2);

test('a tint is mixed with its backdrop by its alpha', () => {
  assert.deepEqual(compositeOver([255, 255, 255], [0, 0, 0], 0.1), [25.5, 25.5, 25.5]);
  assert.deepEqual(compositeOver([200, 100, 0], [10, 20, 30], 0), [10, 20, 30]);
  assert.deepEqual(compositeOver([200, 100, 0], [10, 20, 30], 1), [200, 100, 0]);
});

test('a pair is measured against the tint as painted in that theme', () => {
  const half = { token: 'paper', alpha: 0.5 };
  const tint = { light: half, dark: { token: 'paper', alpha: 1 } };
  const pair = { token: 'ink', background: 'ink', tint };

  // White at 50% over black is rgb 127.5: luminance 0.2140, so (0.2140 + 0.05) / 0.05.
  assert.equal(pairRatio(pair, GREYS, 'light').toFixed(2), '5.28');
  assert.equal(pairRatio(pair, GREYS, 'dark').toFixed(2), '21.00');
  assert.equal(pairRatio({ token: 'ink', background: 'paper' }, GREYS, 'light').toFixed(2), '21.00');
});

test('a pair naming a missing token has no ratio', () => {
  const tint = { light: { token: 'mist', alpha: 0.5 }, dark: { token: 'mist', alpha: 0.5 } };

  assert.equal(pairRatio({ token: 'ink', background: 'paper', tint }, GREYS, 'light'), null);
  assert.equal(pairRatio({ token: 'fog', background: 'paper' }, GREYS, 'light'), null);
});

// WCAG 2.x: L = 0.2126 R + 0.7152 G + 0.0722 B over linearised channels, ratio = (L1 + 0.05) / (L2 + 0.05).
// A channel of 0 or 255 linearises to 0 or 1, so a pure primary's luminance is its own coefficient.
test('the pure primaries measure as the WCAG examples do on white and on black', () => {
  // Red: 1.05 / 0.2626 = 3.998, and 0.2626 / 0.05 = 5.252.
  assert.deepEqual([ratio(RED, WHITE), ratio(RED, BLACK)], ['4.00', '5.25']);
  // Green: 1.05 / 0.7652 = 1.372, and 0.7652 / 0.05 = 15.304.
  assert.deepEqual([ratio(GREEN, WHITE), ratio(GREEN, BLACK)], ['1.37', '15.30']);
  // Blue: 1.05 / 0.1222 = 8.592, and 0.1222 / 0.05 = 2.444.
  assert.deepEqual([ratio(BLUE, WHITE), ratio(BLUE, BLACK)], ['8.59', '2.44']);
  assert.equal(ratio(WHITE, RED), '4.00');
});

test('a mid channel is linearised before it is weighed', () => {
  // 128 / 255 = 0.50196, and ((0.50196 + 0.055) / 1.055) ^ 2.4 = 0.21586.
  // Orange 255 128 0: L = 0.2126 + 0.7152 * 0.21586 = 0.36698, so 1.05 / 0.41698 = 2.518.
  assert.equal(ratio([255, 128, 0], WHITE), '2.52');
  // Navy 0 0 128: L = 0.0722 * 0.21586 = 0.015585. Blue on it: 0.1222 / 0.065585 = 1.863.
  assert.equal(ratio(BLUE, [0, 0, 128]), '1.86');
});

test('a chromatic tint over a chromatic backdrop keeps each share on its own side', () => {
  assert.deepEqual(compositeOver(RED, BLUE, 0), [0, 0, 255]);
  assert.deepEqual(compositeOver(RED, BLUE, 1), [255, 0, 0]);
  assert.deepEqual(compositeOver(RED, BLUE, 0.5), [127.5, 0, 127.5]);
  // A tenth of red and nine tenths of blue: 25.5 and 229.5.
  assert.deepEqual(
    compositeOver(RED, BLUE, 0.1).map((channel) => channel.toFixed(1)),
    ['25.5', '0.0', '229.5'],
  );
});

test('white text is measured on a red tint as painted over blue at each alpha', () => {
  const HUES = { white: [0, 0, 100], red: [0, 100, 50], blue: [240, 100, 50] };
  const on = (alpha) => {
    const fill = { token: 'red', alpha };
    const pair = { token: 'white', background: 'blue', tint: { light: fill, dark: fill } };
    return pairRatio(pair, HUES, 'light').toFixed(2);
  };

  // Alpha 0 is blue alone and alpha 1 is red alone: the ratios of the primaries above.
  assert.deepEqual([on(0), on(1)], ['8.59', '4.00']);
  // 25.5 linearises to 0.010023 and 229.5 to 0.787412:
  // L = 0.2126 * 0.010023 + 0.0722 * 0.787412 = 0.058982, so 1.05 / 0.108982 = 9.635.
  assert.equal(on(0.1), '9.63');
  // 127.5 linearises to 0.214041: L = (0.2126 + 0.0722) * 0.214041 = 0.060959, so 1.05 / 0.110959 = 9.463.
  assert.equal(on(0.5), '9.46');
});
