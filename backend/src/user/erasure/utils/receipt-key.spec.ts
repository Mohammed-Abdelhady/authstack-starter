import { parseReceiptKey, receiptState } from './receipt-key';

// A phone that lost the answer to its delete request decides from these
// answers whether to tell the person the account is gone.
const ISSUED = Date.UTC(2026, 9, 1, 12, 0, 0);
const KEY = `r1.${ISSUED}.${'ab'.repeat(32)}`;
const DAY = 86_400_000;

function at(daysAfterIssue: number): Date {
  return new Date(ISSUED + daysAfterIssue * DAY);
}

describe('deletion receipt keys', () => {
  it('reads the time a well-formed key was made, and stores only a hash of it', () => {
    const key = parseReceiptKey(KEY);

    expect(key).toEqual({
      issuedAt: new Date('2026-10-01T12:00:00.000Z'),
      // shasum -a 256 of the key, worked out apart from the code.
      hash: 'ead48c69c7353a4a7eb7c949a82edaf001709b22ea68a9ae156b0eb37af5361a',
    });
  });

  it.each([
    ['another version', `r2.${ISSUED}.${'ab'.repeat(32)}`],
    ['capital hex', `r1.${ISSUED}.${'AB'.repeat(32)}`],
    ['63 hex digits', `r1.${ISSUED}.${'a'.repeat(63)}`],
    ['no time', `r1..${'ab'.repeat(32)}`],
  ])('refuses a key with %s', (_case, raw) => {
    expect(parseReceiptKey(raw)).toBeNull();
  });
});

describe('what the receipt route answers', () => {
  const key = (): NonNullable<ReturnType<typeof parseReceiptKey>> => {
    const parsed = parseReceiptKey(KEY);
    if (!parsed) throw new Error('the fixture key must parse');
    return parsed;
  };
  const recordedAt = (days: number) => ({
    userId: 'account-1',
    eraseAfter: null,
    recordedAt: at(days),
  });

  it('answers recorded for a stored receipt up to 90 days old', () => {
    expect(receiptState(key(), recordedAt(0), at(90))).toBe('recorded');
  });

  it('answers unknown once the receipt is more than 90 days old', () => {
    expect(receiptState(key(), recordedAt(0), at(90.01))).toBe('unknown');
  });

  it('answers not recorded for a young key that was never stored', () => {
    expect(receiptState(key(), null, at(1))).toBe('not_recorded');
  });

  it('answers unknown, not "not recorded", for an old key whose receipt may be purged', () => {
    expect(receiptState(key(), null, at(91))).toBe('unknown');
  });
});
