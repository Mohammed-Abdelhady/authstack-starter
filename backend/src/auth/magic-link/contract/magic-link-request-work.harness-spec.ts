import { AddressLedger } from '../../../common/persistence/address-ledger';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import { MagicLinkAccounts } from '../stores/magic-link-accounts';
import { MagicLinkStore } from '../stores/magic-link.store';
import {
  LINK_REQUEST,
  LINK_RESPONSE,
  linkServices,
} from './magic-link-contract.harness-spec';

/** One database's adapters, with a count of the statements it was sent. */
export interface RequestWorkProbe {
  readonly links: MagicLinkStore;
  readonly accounts: MagicLinkAccounts;
  readonly runner: UnitOfWorkRunner;
  readonly ledger: AddressLedger;
  /** Statements sent since the last time this was asked. */
  takeStatements(): number;
  seedAccount(account: { email: string; isDeleted: boolean }): Promise<void>;
  close(): Promise<void>;
}

/**
 * What a link request costs the database on each path. A path that sends one
 * statement fewer answers sooner, which is what tells an address apart.
 */
export function describeRequestWork(
  database: string,
  boot: () => Promise<RequestWorkProbe>,
  budgets: { bootMs: number; teardownMs: number },
): void {
  describe(`magic link request work on ${database}`, () => {
    let probe: RequestWorkProbe | undefined;

    beforeAll(async () => {
      probe = await boot();
    }, budgets.bootMs);

    afterAll(async () => {
      await probe?.close();
    }, budgets.teardownMs);

    it('sends the same three statements for an unknown, a known, a deleted and a capped address', async () => {
      if (!probe) throw new Error(`the ${database} probe did not start`);
      const { service } = linkServices({
        clock: new FrozenClock(TEST_NOW),
        links: probe.links,
        accounts: probe.accounts,
        runner: probe.runner,
        ledger: probe.ledger,
      });
      await probe.seedAccount({
        email: 'known@example.test',
        isDeleted: false,
      });
      await probe.seedAccount({ email: 'gone@example.test', isDeleted: true });
      const statementsFor = async (email: string): Promise<number> => {
        probe?.takeStatements();
        await service.request({ email }, LINK_REQUEST, LINK_RESPONSE);
        return probe?.takeStatements() ?? 0;
      };

      const unknown = await statementsFor('unknown@example.test');
      const known = await statementsFor('known@example.test');
      const deleted = await statementsFor('gone@example.test');
      for (let mailed = 1; mailed < 5; mailed += 1) {
        await statementsFor('known@example.test');
      }
      const overCap = await statementsFor('known@example.test');

      expect({ unknown, known, deleted, overCap }).toEqual({
        unknown: 3,
        known: 3,
        deleted: 3,
        overCap: 3,
      });
    });

    it('reads the account behind an address with one statement, whether it is there, missing or deleted', async () => {
      const current = probe;
      if (!current) throw new Error(`the ${database} probe did not start`);
      await current.seedAccount({
        email: 'reader@example.test',
        isDeleted: false,
      });
      await current.seedAccount({
        email: 'reader-gone@example.test',
        isDeleted: true,
      });
      const read = async (email: string) => {
        current.takeStatements();
        const recipient = await current.accounts.findLinkRecipient(email);
        return { recipient, statements: current.takeStatements() };
      };

      expect({
        existing: await read('reader@example.test'),
        missing: await read('reader-none@example.test'),
        deleted: await read('reader-gone@example.test'),
      }).toEqual({
        existing: {
          recipient: { isDeleted: false, locale: 'en' },
          statements: 1,
        },
        missing: { recipient: null, statements: 1 },
        deleted: {
          recipient: { isDeleted: true, locale: 'en' },
          statements: 1,
        },
      });
    });
  });
}
