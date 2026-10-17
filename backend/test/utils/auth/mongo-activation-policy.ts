import { ConfigService } from '@nestjs/config';
import type { Connection } from 'mongoose';
import { AccountCreationPolicy } from '../../../src/auth/services/registration/account-creation-policy';
import { AuthEpochService } from '../../../src/common/services/auth-epoch.service';
import { ApplicationRegistry } from '../../../src/session/applications/application-registry';
import { ApplicationRegistryService } from '../../../src/session/persistence/mongo/application-registry.service';
import { MongoApplicationRegistryStore } from '../../../src/session/persistence/mongo/mongo-application-registry.store';
import { MongoIssuanceApplications } from '../../../src/session/persistence/mongo/mongo-issuance-applications';
import { MongoUnitOfWorkRunner } from '../../../src/session/persistence/mongo/mongo-unit-of-work';
import {
  Application,
  ApplicationSchema,
  type ApplicationDocument,
} from '../../../src/session/persistence/mongo/schemas/application.schema';

export function mongoActivationRegistry(
  connection: Connection,
): ApplicationRegistry {
  connection.model(Application.name, ApplicationSchema);
  return new ApplicationRegistry(
    new MongoUnitOfWorkRunner(connection),
    new MongoApplicationRegistryStore(
      connection.model<ApplicationDocument>(Application.name),
    ),
    new AuthEpochService(new ConfigService({ server: { nodeEnv: 'test' } })),
  );
}

export function mongoActivationPolicy(
  connection: Connection,
): AccountCreationPolicy {
  return new AccountCreationPolicy(
    new MongoIssuanceApplications(
      new ApplicationRegistryService(mongoActivationRegistry(connection)),
    ),
  );
}
