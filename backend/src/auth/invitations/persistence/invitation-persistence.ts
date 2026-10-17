import type { DynamicModule, Provider } from '@nestjs/common';
import { forStorage } from '../../../common/persistence/storage-choice';
import { InvitationStore } from '../stores/invitation.store';
// feature:mongodb:start
import {
  MONGO_INVITATION_MODELS,
  MONGO_INVITATION_PROVIDERS,
} from './mongo/mongo-invitation-persistence';
// feature:mongodb:end
// feature:postgres:start
import { onDatabase } from '../../../common/persistence/postgres/postgres-providers';
import { PostgresInvitationStore } from './postgres/postgres-invitation.store';
// feature:postgres:end

export const INVITATION_PERSISTENCE_IMPORTS: DynamicModule[] = forStorage({
  mongodb: () => [MONGO_INVITATION_MODELS], // feature:mongodb
  postgres: () => [], // feature:postgres
});

export const INVITATION_PERSISTENCE_PROVIDERS: Provider[] = forStorage<
  Provider[]
>({
  mongodb: () => MONGO_INVITATION_PROVIDERS, // feature:mongodb
  // feature:postgres:start
  postgres: () => [
    onDatabase(
      InvitationStore,
      (database) => new PostgresInvitationStore(database),
    ),
  ],
  // feature:postgres:end
});
