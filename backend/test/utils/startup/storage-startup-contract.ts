import { StorageStartup } from '../../../src/common/persistence/storage-startup';

export interface StorageStartupHarness {
  readonly startup: StorageStartup;
  /**
   * Stores two sessions with one credential hash, around the adapters, and
   * says whether the store refused the second.
   */
  refusesDuplicateCredential(): Promise<boolean>;
  /**
   * Removes the unique rule on a session's credential, around the adapters.
   * Answers false where the store's rules are not this adapter's to rebuild.
   */
  loseCredentialRule(): Promise<boolean>;
  /**
   * The adapter as it would run against a database that lacks a migration this
   * build carries. Null where the adapter does not read a migration record.
   */
  behindThisBuild(): StorageStartup | null;
  /** The same for a database that holds a migration this build does not carry. */
  aheadOfThisBuild(): StorageStartup | null;
  /** The names recorded as applied, in order. Empty where there is no record. */
  migrationRecord(): Promise<string[]>;
  close(): Promise<void>;
}

async function refusalOf(prepare: Promise<void>): Promise<unknown> {
  try {
    await prepare;
  } catch (error) {
    return error instanceof Error
      ? { name: error.name, message: error.message }
      : error;
  }
  return 'prepared';
}

/**
 * The storage start-up contract. Every database runs these same cases through
 * its own harness.
 */
export function describeStorageStartupContract(
  database: string,
  boot: () => Promise<StorageStartupHarness>,
  expected: {
    bootMs: number;
    teardownMs: number;
    /** What a database behind this build is told, null where it is not checked. */
    behind: string | null;
    /** What a database ahead of this build is told, null where it is not checked. */
    ahead: string | null;
  },
): void {
  describe(`storage start-up contract on ${database}`, () => {
    let harness: StorageStartupHarness | undefined;
    const current = (): StorageStartupHarness => {
      if (!harness) {
        throw new Error(`the ${database} harness did not start`);
      }
      return harness;
    };

    beforeAll(async () => {
      harness = await boot();
    }, expected.bootMs);

    afterAll(async () => {
      await harness?.close();
    }, expected.teardownMs);

    it('prepares a store that is at this build, twice over, with its unique rules in force', async () => {
      const before = await current().migrationRecord();

      expect({
        first: await refusalOf(current().startup.prepare()),
        second: await refusalOf(current().startup.prepare()),
        duplicateRefused: await current().refusesDuplicateCredential(),
        recordUnchanged:
          JSON.stringify(await current().migrationRecord()) ===
          JSON.stringify(before),
      }).toEqual({
        first: 'prepared',
        second: 'prepared',
        duplicateRefused: true,
        recordUnchanged: true,
      });
    });

    it("puts a lost unique rule back where the rules are the adapter's own", async () => {
      if (!(await current().loseCredentialRule())) {
        // This adapter checks and never changes the store: a migration owns
        // the rule, and the page of known differences says so.
        expect(expected.behind).not.toBeNull();
        return;
      }

      await current().startup.prepare();

      expect(await current().refusesDuplicateCredential()).toBe(true);
    });

    it('refuses a store that is behind this build, names what to apply, and applies nothing', async () => {
      const behind = current().behindThisBuild();
      const before = await current().migrationRecord();

      expect({
        answer: behind === null ? null : await refusalOf(behind.prepare()),
        after: await current().migrationRecord(),
      }).toEqual({
        answer:
          expected.behind === null
            ? null
            : { name: 'StorageNotReadyError', message: expected.behind },
        after: before,
      });
    });

    it('refuses a store that is ahead of this build and names what it does not carry', async () => {
      const ahead = current().aheadOfThisBuild();

      expect(ahead === null ? null : await refusalOf(ahead.prepare())).toEqual(
        expected.ahead === null
          ? null
          : { name: 'StorageNotReadyError', message: expected.ahead },
      );
    });
  });
}
