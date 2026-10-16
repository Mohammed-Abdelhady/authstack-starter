import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import type { HashService } from '../../../common/services/hash.service';
import type { PasswordSignInStore } from '../../../auth/stores/password-sign-in.store';
import type { StoredAccount } from '../../../user/stores/stored-account';
import { USER_SCOPE_ACTION } from '../../constants/user-scope-permissions';
import type { AdminAccountStore } from '../../stores/admin-account.store';
import type { AdminUserAccessService } from './admin-user-access.service';
import { idempotencyKeyReused } from '../staff-mutations/staff-idempotency.service';

/**
 * The account a replayed create made, read again, after the actor's power to
 * create in its audience is checked again. Nothing is written.
 *
 * @throws AppException CONFLICT when that account is gone
 */
export async function replayedAccount(
  services: { accounts: AdminAccountStore; access: AdminUserAccessService },
  work: UnitOfWork,
  replay: { actorId: string; resourceId: string },
): Promise<StoredAccount> {
  const account = await services.accounts.readAccount(work, replay.resourceId);
  if (!account) {
    throw new AppException(
      ErrorCode.CONFLICT,
      'The account this request created no longer exists',
      HttpStatus.CONFLICT,
    );
  }
  await services.access.assertTargetScopeInWork(
    work,
    replay.actorId,
    account.audience,
    USER_SCOPE_ACTION.CREATE,
  );
  return account;
}

/**
 * A request fingerprint leaves the password out, so no value derived from it
 * is stored. A replay checks its password against the account the first
 * request made instead.
 *
 * @throws AppException CONFLICT when the password is not that account's
 */
export async function assertReplayedPassword(
  services: {
    passwords: Pick<PasswordSignInStore, 'findForPasswordCheck'>;
    hashes: Pick<HashService, 'compare'>;
  },
  account: StoredAccount,
  password: string,
): Promise<void> {
  const stored = await services.passwords.findForPasswordCheck(account.email);
  const matches =
    stored?.account.id === account.id &&
    stored.passwordHash !== undefined &&
    (await services.hashes.compare(password, stored.passwordHash));
  if (!matches) throw idempotencyKeyReused();
}
