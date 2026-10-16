import type { ConfigService } from '@nestjs/config';
import { UserRole } from '../../../user/enums/user-role.enum';
import type { StoredAccount } from '../../../user/stores/stored-account';
import {
  EMAIL_CODE_PURPOSE,
  EmailCodeKey,
} from '../../pending-codes/email-code.store';
import { hashPendingCodeGeneration } from '../../utils/pending-code-generation.util';

/** Wrong guesses at the fixed code in one day that switch review access off until the next. */
export const REVIEW_GUESS_LIMIT = 5;

const DAY_MS = 86_400_000;
const CUSTOMER_ROLE: string = UserRole.USER;
/** Keeps a review code's commitment apart from a mailed code's. */
const REVIEW_GENERATION_PREFIX = 'email-code-review:';

/** Review access as the settings name it: one account, one application, one code, an end. */
export interface EmailCodeReview {
  readonly accountId: string;
  readonly clientId: string;
  readonly codeHash: string;
  readonly until: Date;
}

type ReviewSettings = Partial<
  Record<'accountId' | 'clientId' | 'codeHash' | 'until', string>
>;

function filled(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Null unless all four settings hold a value. Start-up refuses a partial set. */
export function reviewOf(config: ConfigService): EmailCodeReview | null {
  const settings = config.get<ReviewSettings>('emailCode.review');
  const accountId = filled(settings?.accountId);
  const clientId = filled(settings?.clientId);
  const codeHash = filled(settings?.codeHash);
  const until = new Date(filled(settings?.until) ?? Number.NaN);
  if (!accountId || !clientId || !codeHash || Number.isNaN(until.getTime())) {
    return null;
  }
  return { accountId, clientId, codeHash, until };
}

/** Review access ends at its date, without a restart. */
export function reviewOpenAt(review: EmailCodeReview, now: Date): boolean {
  return now.getTime() < review.until.getTime();
}

/**
 * The account the settings name, still at this address and still a plain
 * customer: not deactivated, no staff role, no permission of its own.
 */
export function reviewAccountFits(
  account: Pick<
    StoredAccount,
    'id' | 'email' | 'role' | 'permissions' | 'isDeleted'
  > | null,
  review: EmailCodeReview,
  address: string | undefined,
): boolean {
  return (
    account !== null &&
    account.id === review.accountId &&
    !account.isDeleted &&
    address !== undefined &&
    account.email === address &&
    account.role === CUSTOMER_ROLE &&
    account.permissions.length === 0
  );
}

/** The UTC day wrong guesses count in, and the moment the next one starts. */
export function reviewDay(now: Date): { key: string; ends: Date } {
  const start = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  return {
    key: new Date(start).toISOString().slice(0, 10),
    ends: new Date(start + DAY_MS),
  };
}

/** The row that counts wrong guesses at the fixed code for one account and one day. */
export function reviewGuessKey(accountId: string, day: string): EmailCodeKey {
  return {
    ownerId: `${accountId}/${day}`,
    purpose: EMAIL_CODE_PURPOSE.REVIEW_GUESSES,
  };
}

/**
 * What an attempt commits to when it stores the fixed code. It differs from a
 * mailed code's, so the stored code means nothing once the settings stop
 * naming it.
 */
export function reviewCodeGeneration(codeHash: string): string {
  return hashPendingCodeGeneration(`${REVIEW_GENERATION_PREFIX}${codeHash}`);
}
