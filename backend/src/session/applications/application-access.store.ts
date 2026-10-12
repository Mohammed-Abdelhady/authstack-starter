import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { RecordSecurityEventInput } from '../events/security-event-recorder';

export const APPLICATION_SWITCH = {
  SWITCHED: 'switched',
  NOT_REGISTERED: 'not_registered',
} as const;

export type ApplicationSwitch =
  (typeof APPLICATION_SWITCH)[keyof typeof APPLICATION_SWITCH];

export interface AccessGrant {
  id: string;
  userId: string;
  clientId: string;
  allowed: boolean;
  sessionVersion: number;
}

export interface NewBlockedGrant {
  userId: string;
  clientId: string;
  sessionVersion: number;
}

/**
 * What switching an application off and on, and blocking a person from one,
 * needs from a database. Every write takes part in one atomic change with its
 * security event, so every write requires the unit of work. `readGrant` alone
 * commits by itself: it is a plain read, not an authority read, and nothing
 * that issues or keeps a session may rest on it.
 *
 * `takeGrantForChange` takes the account's grants: once it has returned, no
 * other unit of work can issue a session for the account or change this grant
 * until this one ends. An adapter may take them later, at the write that
 * creates or blocks the grant. A second unit of work that reaches taken grants
 * is refused at once with a retryable abort. It does not wait.
 *
 * One person has at most one grant for a client. A second one is refused as a
 * unique conflict named `ISSUANCE_CONSTRAINT.GRANT_USER_CLIENT`.
 */
export abstract class ApplicationAccessStore {
  /** A plain read of the person's grant for the client. Takes nothing. */
  abstract readGrant(
    userId: string,
    clientId: string,
  ): Promise<AccessGrant | null>;

  abstract takeGrantForChange(
    unitOfWork: UnitOfWork,
    userId: string,
    clientId: string,
  ): Promise<AccessGrant | null>;

  abstract createBlockedGrant(
    unitOfWork: UnitOfWork,
    grant: NewBlockedGrant,
  ): Promise<AccessGrant>;

  /** Marks the grant not allowed and advances its version. */
  abstract blockGrant(unitOfWork: UnitOfWork, grantId: string): Promise<void>;

  /** Marks the application disabled and advances its version. */
  abstract disableApplication(
    unitOfWork: UnitOfWork,
    environment: string,
    clientId: string,
  ): Promise<ApplicationSwitch>;

  /** Marks the application enabled. Its version stays where it is. */
  abstract enableApplication(
    unitOfWork: UnitOfWork,
    environment: string,
    clientId: string,
  ): Promise<ApplicationSwitch>;

  abstract appendSecurityEvent(
    unitOfWork: UnitOfWork,
    event: RecordSecurityEventInput,
  ): Promise<void>;
}
