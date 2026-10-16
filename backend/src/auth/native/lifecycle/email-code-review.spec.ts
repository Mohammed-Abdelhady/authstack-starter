import { ConfigService } from '@nestjs/config';
import { hashPendingCodeGeneration } from '../../utils/pending-code-generation.util';
import {
  EmailCodeReview,
  reviewAccountFits,
  reviewCodeGeneration,
  reviewDay,
  reviewOf,
  reviewOpenAt,
} from './email-code-review';

const SETTINGS = {
  accountId: 'reviewer-id',
  clientId: 'mobile',
  codeHash: '$2b$04$fixed.review.code.hash',
  until: '2030-01-31T00:00:00.000Z',
};

const REVIEW: EmailCodeReview = {
  accountId: 'reviewer-id',
  clientId: 'mobile',
  codeHash: '$2b$04$fixed.review.code.hash',
  until: new Date('2030-01-31T00:00:00.000Z'),
};

const REVIEWER = {
  id: 'reviewer-id',
  email: 'reviewer@example.test',
  role: 'user',
  permissions: [],
  isDeleted: false,
};

function configured(review: Record<string, string | undefined>) {
  return new ConfigService({ emailCode: { review } });
}

describe('email code review settings', () => {
  it('reads all four settings, the end as a date', () => {
    expect(reviewOf(configured(SETTINGS))).toEqual(REVIEW);
  });

  it.each([
    ['nothing is set', {}],
    ['the code is missing', { ...SETTINGS, codeHash: undefined }],
    ['the account is blank', { ...SETTINGS, accountId: '  ' }],
    ['the end is not a date', { ...SETTINGS, until: 'next month' }],
  ])('leaves review access off when %s', (_case, review) => {
    expect(reviewOf(configured(review))).toBeNull();
  });
});

describe('who review access lets in', () => {
  it('lets in the named customer account at its own address', () => {
    expect(reviewAccountFits(REVIEWER, REVIEW, 'reviewer@example.test')).toBe(
      true,
    );
  });

  it.each([
    ['no account has the id', null, 'reviewer@example.test'],
    [
      'another account',
      { ...REVIEWER, id: 'other-id' },
      'reviewer@example.test',
    ],
    [
      'a deactivated account',
      { ...REVIEWER, isDeleted: true },
      'reviewer@example.test',
    ],
    ['an address the account no longer has', REVIEWER, 'old@example.test'],
    ['no address', REVIEWER, undefined],
    ['a staff role', { ...REVIEWER, role: 'support' }, 'reviewer@example.test'],
    [
      'a permission of its own',
      { ...REVIEWER, permissions: ['users:read:all'] },
      'reviewer@example.test',
    ],
  ])('refuses %s', (_case, account, address) => {
    expect(reviewAccountFits(account, REVIEW, address)).toBe(false);
  });

  it('ends at its date without a restart', () => {
    expect([
      reviewOpenAt(REVIEW, new Date('2030-01-30T23:59:59.999Z')),
      reviewOpenAt(REVIEW, new Date('2030-01-31T00:00:00.000Z')),
    ]).toEqual([true, false]);
  });
});

describe('the review guess day', () => {
  it('counts up to the last millisecond of a UTC day and starts again at midnight', () => {
    expect([
      reviewDay(new Date('2030-01-05T23:59:59.999Z')),
      reviewDay(new Date('2030-01-06T00:00:00.000Z')),
    ]).toEqual([
      { key: '2030-01-05', ends: new Date('2030-01-06T00:00:00.000Z') },
      { key: '2030-01-06', ends: new Date('2030-01-07T00:00:00.000Z') },
    ]);
  });
});

describe('the commitment to a review code', () => {
  it('differs from the one a mailed code with the same hash gets', () => {
    expect(reviewCodeGeneration(REVIEW.codeHash)).not.toBe(
      hashPendingCodeGeneration(REVIEW.codeHash),
    );
  });
});
