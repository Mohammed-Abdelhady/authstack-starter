import assert from 'node:assert/strict';
import test from 'node:test';
import { compositeOver, pairRatio } from './contrast-math.mjs';

const GREYS = { ink: [0, 0, 0], paper: [0, 0, 100] };

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
