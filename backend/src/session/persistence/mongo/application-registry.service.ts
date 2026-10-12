import { Injectable } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { ApplicationRegistry } from '../../applications/application-registry';
import { applicationDocumentOf } from './mongo-application-records';
import { mongoUnitOfWork } from './mongo-unit-of-work';
import { ApplicationDocument } from './schemas/application.schema';

/**
 * The MongoDB face of the application registry, for callers that still hold a
 * driver session and read Mongoose documents. Every decision is
 * `ApplicationRegistry`'s; this hands back the documents behind what it read.
 * It goes away when its callers read applications through the store.
 */
@Injectable()
export class ApplicationRegistryService {
  constructor(private readonly registry: ApplicationRegistry) {}

  async requireEnabled(
    clientId: string,
    session?: ClientSession,
  ): Promise<ApplicationDocument> {
    return applicationDocumentOf(
      session
        ? await this.registry.requireEnabledIn(
            mongoUnitOfWork(session),
            clientId,
          )
        : await this.registry.requireEnabled(clientId),
    );
  }

  async findByClientId(clientId: string): Promise<ApplicationDocument | null> {
    const application = await this.registry.findByClientId(clientId);
    return application ? applicationDocumentOf(application) : null;
  }

  async findByClientIds(
    clientIds: string[],
    session?: ClientSession,
  ): Promise<ApplicationDocument[]> {
    const applications = session
      ? await this.registry.findByClientIdsIn(
          mongoUnitOfWork(session),
          clientIds,
        )
      : await this.registry.findByClientIds(clientIds);
    return applications.map(applicationDocumentOf);
  }

  seedFirstPartyApplications(): Promise<void> {
    return this.registry.seedFirstPartyApplications();
  }

  ensureClientOriginAllowed(): Promise<void> {
    return this.registry.ensureClientOriginAllowed();
  }

  reconcileNativeApplications(): Promise<void> {
    return this.registry.reconcileNativeApplications();
  }
}
