import { sameHash } from './magic-link-token.util';
import { maskEmail } from './mask-email.util';

describe('maskEmail', () => {
  it.each([
    ['alice@example.com', 'a***@example.com'],
    ['a@example.com', 'a***@example.com'],
    ['first.last+tag@mail.example.co.uk', 'f***@mail.example.co.uk'],
    ['"odd@local"@example.com', '"***@example.com'],
    ['@example.com', '***'],
    ['no-at-sign', '***'],
    ['', '***'],
  ])('shows %s as %s', (email, masked) => {
    expect(maskEmail(email)).toBe(masked);
  });
});

describe('sameHash', () => {
  const HASH = 'ab'.repeat(32);

  it.each([
    ['the same hash', HASH, HASH, true],
    [
      'a hash that differs in its last digit',
      HASH,
      `${'ab'.repeat(31)}ac`,
      false,
    ],
    ['a shorter hash', HASH, 'ab'.repeat(31), false],
    ['two empty values', '', '', false],
    ['text that is not hex', 'not-hex', 'not-hex', false],
  ])('answers for %s', (_name, left, right, same) => {
    expect(sameHash(left, right)).toBe(same);
  });
});
