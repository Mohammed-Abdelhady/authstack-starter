import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { ApplicationRegistry } from '../../applications/application-registry';
import { issuanceApplicationOf } from '../../applications/application-registry.store';
import { IssuanceApplication } from '../../issuance/browser-issuance.store';
import { IssuanceApplications } from '../../issuance/issuance-applications';

/** Sign-in's view of the registry: the registry itself, on its real store. */
export class PostgresIssuanceApplications extends IssuanceApplications {
  constructor(private readonly registry: ApplicationRegistry) {
    super();
  }

  async requireEnabled(
    unitOfWork: UnitOfWork,
    clientId: string,
  ): Promise<IssuanceApplication> {
    return issuanceApplicationOf(
      await this.registry.requireEnabledIn(unitOfWork, clientId),
    );
  }
}
