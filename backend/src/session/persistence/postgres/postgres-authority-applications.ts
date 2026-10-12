import { ApplicationRegistry } from '../../applications/application-registry';
import { issuanceApplicationOf } from '../../applications/application-registry.store';
import {
  AuthorityApplication,
  AuthorityApplications,
} from '../../authority/authority-applications';

/**
 * Validation's view of the registry: the registry itself, on its real store.
 * Each read is a committed authority read.
 */
export class PostgresAuthorityApplications extends AuthorityApplications {
  constructor(private readonly registry: ApplicationRegistry) {
    super();
  }

  async findByClientId(clientId: string): Promise<AuthorityApplication | null> {
    const application = await this.registry.findByClientId(clientId);
    return application ? issuanceApplicationOf(application) : null;
  }

  async findByClientIds(clientIds: string[]): Promise<AuthorityApplication[]> {
    return (await this.registry.findByClientIds(clientIds)).map(
      issuanceApplicationOf,
    );
  }
}
