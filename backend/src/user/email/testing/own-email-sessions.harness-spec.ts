import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  AccountSessions,
  SessionRevocationReason,
} from '../../stores/account-sessions';
import { copied, type RollsBack } from './own-email-memory.harness-spec';

export interface RevocationRecord {
  userId: string;
  keptSessionId?: string;
  reason?: string;
}

/** Live sessions by account, ended the way the revoker ends them. */
export class MemorySessions extends AccountSessions implements RollsBack {
  readonly live = new Map<string, { ids: string[] }>();
  readonly revocations: RevocationRecord[] = [];

  snapshot(): () => void {
    const restore = copied(this.live);
    const count = this.revocations.length;
    return () => {
      restore();
      this.revocations.length = count;
    };
  }

  signIn(userId: string, ...sessionIds: string[]): void {
    const ids = this.live.get(userId)?.ids ?? [];
    this.live.set(userId, { ids: [...ids, ...sessionIds] });
  }

  liveOf(userId: string): string[] {
    return this.live.get(userId)?.ids ?? [];
  }

  revokeAll(
    _unitOfWork: UnitOfWork,
    userId: string,
    reason?: SessionRevocationReason,
  ): Promise<number> {
    const ended = this.liveOf(userId).length;
    this.live.set(userId, { ids: [] });
    this.revocations.push({ userId, reason: reason?.reasonCode });
    return Promise.resolve(ended);
  }

  revokeAllExcept(
    _unitOfWork: UnitOfWork,
    userId: string,
    keptSessionId: string,
    reasonCode?: string,
  ): Promise<number> {
    const ids = this.liveOf(userId);
    if (!ids.includes(keptSessionId)) {
      return Promise.reject(sessionEnded());
    }
    this.live.set(userId, { ids: [keptSessionId] });
    this.revocations.push({ userId, keptSessionId, reason: reasonCode });
    return Promise.resolve(ids.length - 1);
  }

  assertLive(
    _unitOfWork: UnitOfWork,
    userId: string,
    sessionId: string,
  ): Promise<void> {
    return this.liveOf(userId).includes(sessionId)
      ? Promise.resolve()
      : Promise.reject(sessionEnded());
  }
}

function sessionEnded(): AppException {
  return new AppException(
    ErrorCode.SESSION_INVALID,
    'Current session is no longer active',
    HttpStatus.UNAUTHORIZED,
  );
}
