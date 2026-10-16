import type { UnitOfWork } from '../../common/persistence/unit-of-work';
import { ERASURE_HOOK_CODE_PATTERN } from './constants/erasure.constants';
import type { ErasureSubject } from './types/erasure';

/**
 * What a host product implements to remove its own data for an account
 * before the account itself goes. Bound in `src/host/account-erasure.ts`.
 *
 * The worker may call `erase` more than once for one account: after a crash,
 * after a failure, or when two runs overlap. A second call must do no harm.
 */
export abstract class AccountErasureHook {
  /**
   * True when the host's data lives in this database: `erase` then runs inside
   * the transaction that removes the account, with its unit of work, and a
   * failure rolls the whole removal back.
   */
  abstract readonly runsInEraseTransaction: boolean;

  /** Throw to fail the attempt; it is retried later. */
  abstract erase(
    subject: ErasureSubject,
    unitOfWork?: UnitOfWork,
  ): Promise<void>;
}

/**
 * A failure a hook may name. Only the code is kept, and only when it is a
 * short lowercase code; an error's message never reaches a job or a log.
 */
export class AccountErasureHookError extends Error {
  constructor(readonly code: string) {
    super('The account erasure hook failed');
    this.name = 'AccountErasureHookError';
  }

  get usableCode(): string | undefined {
    return ERASURE_HOOK_CODE_PATTERN.test(this.code) ? this.code : undefined;
  }
}
