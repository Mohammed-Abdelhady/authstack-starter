import type { Kysely } from 'kysely';
import { ConfigService } from '@nestjs/config';
import type { ApplicationPolicyConfiguration } from '../../src/config/types/host-policy.type';
import { SIGN_UP_POLICY } from '../../src/config/constants/host-contracts';
import { AuthEpochService } from '../../src/common/services/auth-epoch.service';
import type { PostgresTables } from '../../src/common/persistence/postgres/postgres-database';
import { PostgresUnitOfWorkRunner } from '../../src/common/persistence/postgres/postgres-unit-of-work';
import { ApplicationRegistry } from '../../src/session/applications/application-registry';
import { PostgresApplicationRegistryStore } from '../../src/session/persistence/postgres/postgres-application-registry.store';
import { PostgresIssuanceApplications } from '../../src/session/persistence/postgres/postgres-issuance-applications';
import {
  ADMIN_CLIENT_ID,
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
  DEFAULT_API_AUDIENCE,
  WEB_CLIENT_ID,
} from '../../src/session/constants/client-ids';
import {
  ADMIN_ABSOLUTE_LIFETIME_MS,
  ADMIN_IDLE_LIFETIME_MS,
  WEB_ABSOLUTE_LIFETIME_MS,
  WEB_IDLE_LIFETIME_MS,
} from '../../src/session/constants/session-policy';
import {
  CONTRACT_AUTH_EPOCH,
  CONTRACT_ENVIRONMENT,
} from '../utils/session/issuance-contract/issuance-contract-harness';

export function postgresAccountsApplications(database: Kysely<PostgresTables>) {
  const authEpoch = new AuthEpochService(
    new ConfigService({
      auth: { epoch: CONTRACT_AUTH_EPOCH },
      server: { nodeEnv: CONTRACT_ENVIRONMENT },
    }),
  );
  const registry = new ApplicationRegistry(
    new PostgresUnitOfWorkRunner(database),
    new PostgresApplicationRegistryStore(database),
    authEpoch,
  );
  const configureCreationApplication = async (
    clientId: string,
    policy: ApplicationPolicyConfiguration,
  ): Promise<void> => {
    const admin = clientId === ADMIN_CLIENT_ID;
    const values = {
      display_name: clientId,
      platform: admin
        ? APPLICATION_PLATFORM.ADMIN
        : clientId === WEB_CLIENT_ID
          ? APPLICATION_PLATFORM.WEB
          : APPLICATION_PLATFORM.NATIVE,
      client_type: admin
        ? APPLICATION_CLIENT_TYPE.CONFIDENTIAL
        : APPLICATION_CLIENT_TYPE.PUBLIC,
      enabled: true,
      sign_up: policy.signUp ?? SIGN_UP_POLICY.OPEN,
      account_audience: policy.audience ?? null,
      require_passkey: policy.requirePasskey ?? false,
      allowed_scopes: [DEFAULT_API_AUDIENCE],
      audiences: [DEFAULT_API_AUDIENCE],
      absolute_lifetime_ms: admin
        ? ADMIN_ABSOLUTE_LIFETIME_MS
        : WEB_ABSOLUTE_LIFETIME_MS,
      idle_lifetime_ms: admin ? ADMIN_IDLE_LIFETIME_MS : WEB_IDLE_LIFETIME_MS,
    };
    await database
      .insertInto('applications')
      .values({
        ...values,
        environment: CONTRACT_ENVIRONMENT,
        client_id: clientId,
      })
      .onConflict((conflict) =>
        conflict.columns(['client_id', 'environment']).doUpdateSet(values),
      )
      .execute();
  };
  return {
    authEpoch,
    issuanceApplications: new PostgresIssuanceApplications(registry),
    configureCreationApplication,
    seedCreationApplications: async (): Promise<void> => {
      await configureCreationApplication(WEB_CLIENT_ID, {});
      await configureCreationApplication(ADMIN_CLIENT_ID, {});
    },
  };
}
