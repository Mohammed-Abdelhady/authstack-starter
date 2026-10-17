import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import type { AccountErasureRead, ErasureFacts } from '../types/erasure';

/**
 * Step 3 of an erasure, inside one unit of work. The list of what it removes
 * is in docs/reference/account-erasure.md; a new table that points at an
 * account joins both.
 */
export abstract class AccountEraser {
  /**
   * Takes the account row and reads what the removal goes by: its session
   * ids, the addresses on the row and its linked identities. Null when the
   * account is gone, or is no longer deactivated with an erasure date that
   * `now` has reached, so a restored account is never removed.
   */
  abstract readFactsIn(
    unitOfWork: UnitOfWork,
    userId: string,
    now: Date,
  ): Promise<AccountErasureRead | null>;

  /**
   * Removes every row that points at the account, its sessions or its
   * addresses, blanks the personal fields of log rows where it is actor or
   * target, and removes the account.
   */
  abstract eraseIn(unitOfWork: UnitOfWork, facts: ErasureFacts): Promise<void>;
}
