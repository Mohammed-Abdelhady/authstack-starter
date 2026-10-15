import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../test/utils/session-authority-harness';
import {
  describeRequestWork,
  RequestWorkProbe,
} from '../../contract/magic-link-request-work.harness-spec';
import { bootMongoMagicLinkHarness } from './contract/mongo-magic-link.harness-spec';

/** The commands that read or write a collection. The rest is the driver's own. */
const STATEMENTS = new Set(['find', 'insert', 'update', 'findAndModify']);

async function bootMongoProbe(): Promise<RequestWorkProbe> {
  let statements = 0;
  const harness = await bootMongoMagicLinkHarness((commandName) => {
    if (STATEMENTS.has(commandName)) statements += 1;
  });

  return {
    links: harness.links,
    accounts: harness.accounts,
    runner: harness.runner,
    ledger: harness.ledger,
    issuanceApplications: harness.issuanceApplications,
    takeStatements: () => {
      const sent = statements;
      statements = 0;
      return sent;
    },
    seedAccount: async (account) => {
      await harness.seedAccount({ ...account, isVerified: true });
    },
    close: () => harness.close(),
  };
}

describeRequestWork('MongoDB', bootMongoProbe, {
  bootMs: SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  teardownMs: SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
});
