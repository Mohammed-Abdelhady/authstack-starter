import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { IssuanceApplication } from '../../issuance/browser-issuance.store';
import { IssuanceApplications } from '../../issuance/issuance-applications';
import { ApplicationRegistryService } from './application-registry.service';
import { toIssuanceApplication } from './mongo-issuance-mappers';
import { mongoSessionOf } from './mongo-unit-of-work';

@Injectable()
export class MongoIssuanceApplications extends IssuanceApplications {
  constructor(private readonly registry: ApplicationRegistryService) {
    super();
  }

  async requireEnabled(
    unitOfWork: UnitOfWork,
    clientId: string,
  ): Promise<IssuanceApplication> {
    return toIssuanceApplication(
      await this.registry.requireEnabled(clientId, mongoSessionOf(unitOfWork)),
    );
  }
}
