import type { UnitOfWork } from '../../common/persistence/unit-of-work';
import type { StoredSession } from '../authority/session-authority.store';

/** The relying party a promoted credential has to belong to. */
export interface CredentialRelyingParty {
  readonly rpId: string;
  /** A credential stored without a relying party, before 0026, counts as this one. */
  readonly includesUnmarked: boolean;
}

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
    _relyingParty: CredentialRelyingParty,
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
