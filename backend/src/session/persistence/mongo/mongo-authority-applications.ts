import { Injectable } from '@nestjs/common';
import { singleStatement } from '../../../common/persistence/mongo/mongo-unique-conflict';
import {
  AuthorityApplication,
  AuthorityApplications,
} from '../../authority/authority-applications';
import { ApplicationRegistryService } from './application-registry.service';
import { toIssuanceApplication } from './mongo-issuance-mappers';

/** Asks the registry, which makes each of these a linearizable read. */
@Injectable()
export class MongoAuthorityApplications extends AuthorityApplications {
  constructor(private readonly registry: ApplicationRegistryService) {
    super();
  }

  async findByClientId(clientId: string): Promise<AuthorityApplication | null> {
    const application = await singleStatement(() =>
      this.registry.findByClientId(clientId),
    );
    return application ? toIssuanceApplication(application) : null;
  }

  async findByClientIds(clientIds: string[]): Promise<AuthorityApplication[]> {
    const applications = await singleStatement(() =>
      this.registry.findByClientIds(clientIds),
    );
    return applications.map(toIssuanceApplication);
  }
}
