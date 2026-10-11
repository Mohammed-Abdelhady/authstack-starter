import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import { MagicLinkAccounts } from '../stores/magic-link-accounts';
import { MagicLinkStore } from '../stores/magic-link.store';
import { LINK_REQUEST, linkServices } from './magic-link-contract.harness-spec';

/** One database's adapters, with a count of the statements it was sent. */
export interface RequestWorkProbe {
  readonly links: MagicLinkStore;
  readonly accounts: MagicLinkAccounts;
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
      });
      await probe.seedAccount({
        email: 'known@example.test',
        isDeleted: false,
      });
      await probe.seedAccount({ email: 'gone@example.test', isDeleted: true });
      const statementsFor = async (email: string): Promise<number> => {
        probe?.takeStatements();
        await service.request({ email }, LINK_REQUEST);
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
  });
}
