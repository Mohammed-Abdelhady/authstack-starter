import { Provider } from '@nestjs/common';
import { UnitOfWork } from '../../../src/common/persistence/unit-of-work';
import {
  AccountSessions,
  SessionRevocationReason,
} from '../../../src/user/stores/account-sessions';

/** The mock a unit spec reads its sign-out calls from. */
export interface RecordedSignOuts {
  invalidateAllSessions(
    userId: string,
    unitOfWork: UnitOfWork,
    reason?: SessionRevocationReason,
  ): Promise<number>;
  invalidateAllSessionsExceptSession?(
    userId: string,
    keptSessionId: string,
    unitOfWork: UnitOfWork,
  ): Promise<number>;
}

/**
 * Hands each sign-out an account change asks for to a mock, for unit specs
 * that run a service on mocked models and only check that the sign-out was
 * asked for. Revocation itself is covered on a real database by the contract.
 */
class RecordedAccountSessions extends AccountSessions {
  constructor(private readonly recorded: RecordedSignOuts) {
    super();
  }

  revokeAll(
    unitOfWork: UnitOfWork,
    userId: string,
    reason?: SessionRevocationReason,
  ): Promise<number> {
    return reason
      ? this.recorded.invalidateAllSessions(userId, unitOfWork, reason)
      : this.recorded.invalidateAllSessions(userId, unitOfWork);
  }

  revokeAllExcept(
    unitOfWork: UnitOfWork,
    userId: string,
    keptSessionId: string,
  ): Promise<number> {
    if (!this.recorded.invalidateAllSessionsExceptSession) {
      throw new Error('this spec records no "sign out everywhere else"');
    }
    return this.recorded.invalidateAllSessionsExceptSession(
      userId,
      keptSessionId,
      unitOfWork,
    );
  }
}

export function recordedAccountSessions(recorded: RecordedSignOuts): Provider {
  return {
    provide: AccountSessions,
    useValue: new RecordedAccountSessions(recorded),
  };
}
