import assert from 'node:assert/strict';
import test from 'node:test';
import { selectWorkerCount } from './run-jest-support.mjs';

for (const [memory, expected] of [
  [0, 1],
  [68_206_592, 1],
  [2_147_483_647, 1],
  [2_147_483_648, 1],
  [2_147_483_649, 1],
  [4_294_967_295, 1],
  [4_294_967_296, 2],
  [34_359_738_368, 11],
  [Number.NaN, 1],
  [-1, 1],
]) {
  test(`memory ${memory} admits ${expected} workers`, () => {
    assert.equal(selectWorkerCount(1, 11, memory), expected);
  });
}

test('memory admission respects the requested ceiling and overlapping runs', () => {
  assert.equal(selectWorkerCount(1, 3, 34_359_738_368), 3);
  assert.equal(selectWorkerCount(2, 11, 34_359_738_368), 1);
  assert.equal(selectWorkerCount(1, 11), 11);
});
