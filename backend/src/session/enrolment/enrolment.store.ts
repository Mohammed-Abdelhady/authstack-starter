import type { UnitOfWork } from '../../common/persistence/unit-of-work';
import type { StoredSession } from '../authority/session-authority.store';

export abstract class EnrolmentStore {
  abstract readSessionIn(
    work: UnitOfWork,
    sessionId: string,
  ): Promise<StoredSession | null>;

  /** A build without passkeys cannot supply a credential for promotion. */
  hasCredentialIn(
    _work: UnitOfWork,
    _userId: string,
    _credentialId: string,
  ): Promise<boolean> {
    return Promise.resolve(false);
  }

  /** Retires earlier enrolments for this account and application only, and returns their ids. */
  abstract replaceIn(
    work: UnitOfWork,
    userId: string,
    clientId: string,
    now: Date,
  ): Promise<string[]>;

  /** Fences the session against another registration or revocation. */
  abstract retireIn(
    work: UnitOfWork,
    sessionId: string,
    now: Date,
  ): Promise<boolean>;
}
