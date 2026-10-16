import { ConfigService } from '@nestjs/config';
import type { PasswordCandidate } from '../../../auth/stores/password-sign-in.store';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import { HashService } from '../../../common/services/hash.service';
import type { StoredAccount } from '../../../user/stores/stored-account';
import { assertReplayedPassword } from './admin-user-replay';

const CREATED: StoredAccount = {
  id: 'created-id',
  email: 'created@example.test',
  name: 'Created',
  role: 'support',
  permissions: [],
  authProvider: 'email',
  linkedAccounts: [],
  linkedProviders: ['email'],
  isVerified: true,
  isDeleted: false,
  sessionVersion: 0,
  addressGeneration: 0,
  locale: 'en',
  twoFactorEnabled: false, // feature:totp
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

async function refusal(promise: Promise<void>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

// Failure: a create sent again with its key and only another password reports success, so staff hand out a password that does not work.
describe('replayed account create password', () => {
  const hashes = new HashService(new ConfigService({ bcrypt: { rounds: 4 } }));
  let candidate: PasswordCandidate | null;
  const passwords = {
    findForPasswordCheck: () => Promise.resolve(candidate),
  };

  beforeEach(async () => {
    candidate = {
      account: CREATED,
      passwordHash: await hashes.hash('first-password'),
    };
  });

  it('replays the request that carried the same password', async () => {
    await expect(
      assertReplayedPassword({ passwords, hashes }, CREATED, 'first-password'),
    ).resolves.toBeUndefined();
  });

  it('refuses the same key with another password', async () => {
    const error = await refusal(
      assertReplayedPassword({ passwords, hashes }, CREATED, 'second-password'),
    );
    expect(error).toBeInstanceOf(AppException);
    expect(error).toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it('refuses when the address now signs in another account', async () => {
    if (!candidate) throw new Error('Candidate missing');
    candidate = { ...candidate, account: { ...CREATED, id: 'other-id' } };
    const error = await refusal(
      assertReplayedPassword({ passwords, hashes }, CREATED, 'first-password'),
    );
    expect(error).toMatchObject({ code: ErrorCode.CONFLICT });
  });
});
