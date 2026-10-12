import { ConfigService } from '@nestjs/config';
import { AppException } from '../../../common/exceptions/app.exception';
import { HashService } from '../../../common/services/hash.service';
import { AccountsContractHarness } from '../../../../test/utils/user/accounts-contract/accounts-contract-harness';
import { verifyPasswordCredentials } from './password-credentials';

const EMAIL = 'password-check@example.test';
const PASSWORD = 'Correct-Horse-9';
const WRONG_PASSWORD = 'Wrong-Horse-9';
const BCRYPT_ROUNDS = 4;

export function describePasswordCredentials(
  database: string,
  boot: () => Promise<AccountsContractHarness>,
  budgets: { bootMs: number; teardownMs: number; resetMs: number },
): void {
  describe(`password credentials on ${database}`, () => {
    let harness: AccountsContractHarness | undefined;
    let hashService: HashService;
    let storedHash: string;
    let compare: jest.SpyInstance<Promise<boolean>, [string, string]>;

    const current = (): AccountsContractHarness => {
      if (!harness) throw new Error(`${database} harness did not start`);
      return harness;
    };

    beforeAll(async () => {
      harness = await boot();
      hashService = new HashService(
        new ConfigService({ bcrypt: { rounds: BCRYPT_ROUNDS } }),
      );
      await hashService.onModuleInit();
      storedHash = await hashService.hash(PASSWORD);
      compare = jest.spyOn(hashService, 'compare');
    }, budgets.bootMs);

    afterAll(async () => {
      compare?.mockRestore();
      await harness?.close();
    }, budgets.teardownMs);

    beforeEach(async () => {
      await current().reset();
      compare.mockClear();
    }, budgets.resetMs);

    async function seed(
      passwordHash?: string,
      deleted = false,
    ): Promise<string> {
      return current().seedAccount({
        email: EMAIL,
        role: 'user',
        passwordHash,
        deleted,
      });
    }

    async function rejection(): Promise<{ code: string; status: number }> {
      try {
        await verifyPasswordCredentials(current().passwords, hashService, {
          email: EMAIL,
          password: WRONG_PASSWORD,
        });
      } catch (error) {
        if (error instanceof AppException) {
          return { code: error.code, status: error.getStatus() };
        }
        throw error;
      }
      throw new Error('invalid credentials were accepted');
    }

    it('returns the active stored account after a valid password without exposing its hash', async () => {
      const id = await seed(storedHash);

      const account = await verifyPasswordCredentials(
        current().passwords,
        hashService,
        { email: EMAIL, password: PASSWORD },
      );

      expect({
        id: account.id,
        sessionVersion: account.sessionVersion,
        passwordHash: Reflect.get(account, 'passwordHash'),
        comparisons: compare.mock.calls,
      }).toEqual({
        id,
        sessionVersion: 0,
        passwordHash: undefined,
        comparisons: [[PASSWORD, storedHash]],
      });
    });

    it('rejects a wrong password after one comparison against the stored hash', async () => {
      await seed(storedHash);

      expect(await rejection()).toEqual({
        code: 'INVALID_CREDENTIALS',
        status: 401,
      });
      expect(compare.mock.calls).toEqual([[WRONG_PASSWORD, storedHash]]);
    });

    it.each([
      ['missing', false, false],
      ['passwordless', true, false],
      ['deleted', true, true],
    ])(
      'rejects a %s account after one dummy comparison',
      async (_name, exists, deleted) => {
        if (exists) await seed(deleted ? storedHash : undefined, deleted);

        expect(await rejection()).toEqual({
          code: 'INVALID_CREDENTIALS',
          status: 401,
        });
        expect(compare.mock.calls).toHaveLength(1);
        expect(compare.mock.calls[0]?.[0]).toBe(WRONG_PASSWORD);
        expect(compare.mock.calls[0]?.[1]).not.toBe(storedHash);
      },
    );
  });
}
