import { IssuanceApplication } from '../issuance/browser-issuance.store';

export type AuthorityApplication = IssuanceApplication;

/**
 * Committed authority reads of registered applications, for this environment.
 * The registry answers them until it has a store of its own.
 */
export abstract class AuthorityApplications {
  abstract findByClientId(
    clientId: string,
  ): Promise<AuthorityApplication | null>;

  abstract findByClientIds(
    clientIds: string[],
  ): Promise<AuthorityApplication[]>;
}
