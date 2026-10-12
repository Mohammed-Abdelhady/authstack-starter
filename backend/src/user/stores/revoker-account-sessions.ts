import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { SessionRevoker } from '../../session/revocation/session-revoker';
import { AccountSessions, SessionRevocationReason } from './account-sessions';

/**
 * Ends an account's sessions through the session revoker, in the caller's unit
 * of work. The same class serves every database: what differs is the store the
 * revoker was built on.
 */
@Injectable()
export class RevokerAccountSessions extends AccountSessions {
  constructor(private readonly revoker: SessionRevoker) {
    super();
  }

  revokeAll(
    unitOfWork: UnitOfWork,
    userId: string,
    reason?: SessionRevocationReason,
  ): Promise<number> {
    return this.revoker.revokeAllForUserIn(unitOfWork, userId, reason);
  }

  revokeAllExcept(
    unitOfWork: UnitOfWork,
    userId: string,
    keptSessionId: string,
  ): Promise<number> {
    return this.revoker.revokeAllOthersExceptSessionIn(
      unitOfWork,
      userId,
      keptSessionId,
    );
  }
}
