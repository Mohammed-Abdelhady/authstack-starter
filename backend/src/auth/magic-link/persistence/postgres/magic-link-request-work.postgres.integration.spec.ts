import { ConfigService } from '@nestjs/config';
import { AuthEpochService } from '../../../../common/services/auth-epoch.service';
import { ApplicationRegistry } from '../../../../session/applications/application-registry';
import { PostgresApplicationRegistryStore } from '../../../../session/persistence/postgres/postgres-application-registry.store';
import { PostgresIssuanceApplications } from '../../../../session/persistence/postgres/postgres-issuance-applications';
import { KyselyPlugin } from 'kysely';
import { PostgresAddressLedger } from '../../../../common/persistence/postgres/postgres-address-ledger';
import { PostgresUnitOfWorkRunner } from '../../../../common/persistence/postgres/postgres-unit-of-work';
import { openTestConnection } from '../../../../../test/postgres/postgres-connection';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../../../test/postgres/server/postgres-test-server';
import {
  describeRequestWork,
  RequestWorkProbe,
} from '../../contract/magic-link-request-work.harness-spec';
import {
  PostgresMagicLinkAccounts,
  PostgresMagicLinkStore,
} from './postgres-magic-link.store';

// feature:mongodb:start
jest.mock('mongoose', () => {
  throw new Error('mongoose was loaded on the PostgreSQL path');
});
jest.mock('mongodb', () => {
  throw new Error('mongodb was loaded on the PostgreSQL path');
});
jest.mock('@nestjs/mongoose', () => {
  throw new Error('@nestjs/mongoose was loaded on the PostgreSQL path');
});
// feature:mongodb:end

async function bootPostgresProbe(): Promise<RequestWorkProbe> {
  const connection = await openTestConnection();
  let statements = 0;
  const counting: KyselyPlugin = {
    transformQuery: (query) => {
      statements += 1;
      return query.node;
    },
    transformResult: (answer) => Promise.resolve(answer.result),
  };
  const counted = connection.database.withPlugin(counting);
  const runner = new PostgresUnitOfWorkRunner(counted);
  const registry = new ApplicationRegistry(
    runner,
    new PostgresApplicationRegistryStore(counted),
    new AuthEpochService(new ConfigService({})),
  );
  await registry.seedFirstPartyApplications();

  return {
    links: new PostgresMagicLinkStore(counted),
    accounts: new PostgresMagicLinkAccounts(counted),
    runner,
    issuanceApplications: new PostgresIssuanceApplications(registry),
    ledger: new PostgresAddressLedger(),
    takeStatements: () => {
      const sent = statements;
      statements = 0;
      return sent;
    },
    seedAccount: async (account) => {
      await connection.database
        .insertInto('users')
        .values({
          email: account.email,
          name: 'Work Tester',
          is_verified: true,
          is_deleted: account.isDeleted,
        })
        .execute();
    },
    close: connection.close,
  };
}

describeRequestWork('PostgreSQL', bootPostgresProbe, {
  bootMs: POSTGRES_BOOT_TIMEOUT_MS,
  teardownMs: POSTGRES_TEARDOWN_TIMEOUT_MS,
});
