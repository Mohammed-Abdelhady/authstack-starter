import assert from 'node:assert/strict';
import test from 'node:test';
import { findBannedToken } from './checker.mjs';

const CAST = 'as unk' + 'nown as';
const INLINE = 'inline eslint configuration';

for (const [source, token] of [
  ['// es' + 'lint is run by lint-staged', null],
  ['/* es' + 'lint 9 requires flat config */', null],
  ['/* es' + 'lint rule names may contain a slash */', null],
  ['/* es' + 'lint no-alert: 0 */', INLINE],
  ['/* es' + 'lint "no-alert": "off" */', INLINE],
  ['/* es' + 'lint @typescript-eslint/no-explicit-' + 'a' + 'ny: 0 */', INLINE],
  ['(input as unk' + 'nown /* gap */) /* next */ as string;', CAST],
  ['(input as unk' + 'nown)as string;', CAST],
  ['fn(input as unk' + 'nown) as string;', null],
  ['input as unk' + 'nown/* gap */astring;', null],
  ['export const value = <T>(<unk' + 'nown>x);', CAST],
]) {
  test(`token spelling boundary: ${source}`, () => {
    assert.equal(findBannedToken(source), token);
  });
}
