import type { UnitOfWork } from '../../common/persistence/unit-of-work';

/** What signing in to the admin application asks of an administrator. */
export interface AdminSignInRule {
  /**
   * The admin application's relying party when it requires a passkey, or null
   * when it does not. `includesUnmarked` takes in passkeys stored before
   * relying parties were recorded, which all belong to the web one.
   */
  readonly passkeyRelyingParty: {
    readonly rpId: string;
    readonly includesUnmarked: boolean;
  } | null;
  /** Accounts left out of the count, such as the target of the change. */
  readonly excluding: readonly string[];
}

/**
 * Who can still sign in as an administrator. Active and not deleted always.
 * With a passkey required: holding one for its relying party. Without: a
 * verified address with no change pending on it.
 */
export abstract class AdminRosterStore {
  /**
   * Serialises every change that could lower the count, until the unit of
   * work ends. Take it before reading or changing any administrator.
   */
  abstract lock(unitOfWork: UnitOfWork): Promise<void>;

  abstract countAdminsWhoCanSignIn(
    unitOfWork: UnitOfWork,
    rule: AdminSignInRule,
  ): Promise<number>;

  /** Whether any administrator account is active. A deactivated one does not count. */
  abstract hasActiveAdministrator(unitOfWork: UnitOfWork): Promise<boolean>;
}
