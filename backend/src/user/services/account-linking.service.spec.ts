import { AccountLinkingService } from './account-linking.service';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { EMAIL_PROVIDER } from '../../common/constants/oauth-providers';
import {
  buildUser,
  createHarness,
  linkedAccount,
  GOOGLE_PROFILE,
  USER_ID,
  type MockUser,
} from '../persistence/mongo/services/account-linking.harness-spec';

describe('AccountLinkingService link and unlink', () => {
  let service: AccountLinkingService;
  let resolveUser: (user: MockUser | null) => void;
  let closeHarness: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const harness = await createHarness();
    service = harness.service;
    resolveUser = harness.resolveUser;
    closeHarness = harness.close;
  });

  afterEach(async () => {
    await closeHarness?.();
  });

  describe('linkProvider', () => {
    it('should append the account and take the first provider as primary', async () => {
      const user = buildUser();
      resolveUser(user);

      const result = await service.linkProvider(
        USER_ID,
        'google',
        GOOGLE_PROFILE,
      );

      expect(result.linkedAccounts).toHaveLength(1);
      expect(result.linkedAccounts[0]).toMatchObject({
        provider: 'google',
        providerId: 'google-123',
      });
      expect(result.primaryProvider).toBe('google');
      expect(user.save).toHaveBeenCalled();
    });

    it('should keep an existing primary provider', async () => {
      const user = buildUser({
        primaryProvider: 'github',
        linkedAccounts: [linkedAccount('github')],
      });
      resolveUser(user);

      const result = await service.linkProvider(
        USER_ID,
        'google',
        GOOGLE_PROFILE,
      );

      expect(result.primaryProvider).toBe('github');
    });

    it('should reject a provider that is linked already', async () => {
      resolveUser(buildUser({ linkedAccounts: [linkedAccount('google')] }));

      await expect(
        service.linkProvider(USER_ID, 'google', GOOGLE_PROFILE),
      ).rejects.toMatchObject({
        code: ErrorCode.PROVIDER_ALREADY_LINKED,
        status: 409,
      });
    });

    it('should reject a profile whose email differs from the account', async () => {
      const user = buildUser();
      resolveUser(user);

      await expect(
        service.linkProvider(USER_ID, 'google', {
          ...GOOGLE_PROFILE,
          email: 'someone-else@example.com',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.EMAIL_MISMATCH_ON_LINK,
        status: 409,
      });
      expect(user.save).not.toHaveBeenCalled();
    });

    it('should map a duplicate key error to OAUTH_ACCOUNT_LINKED_ELSEWHERE', async () => {
      const user = buildUser();
      user.save.mockRejectedValue({ code: 11000 });
      resolveUser(user);

      await expect(
        service.linkProvider(USER_ID, 'google', GOOGLE_PROFILE),
      ).rejects.toMatchObject({
        code: ErrorCode.OAUTH_ACCOUNT_LINKED_ELSEWHERE,
        status: 409,
      });
    });

    it('should rethrow a save failure that is not a duplicate key', async () => {
      const user = buildUser();
      user.save.mockRejectedValue(new Error('write concern failed'));
      resolveUser(user);

      await expect(
        service.linkProvider(USER_ID, 'google', GOOGLE_PROFILE),
      ).rejects.toThrow('write concern failed');
    });

    it('should treat a soft deleted user as missing', async () => {
      resolveUser(buildUser({ isDeleted: true }));

      await expect(
        service.linkProvider(USER_ID, 'google', GOOGLE_PROFILE),
      ).rejects.toMatchObject({
        code: ErrorCode.USER_NOT_FOUND,
        status: 404,
      });
    });
  });

  describe('unlinkProvider', () => {
    const twoProviderUser = (): MockUser =>
      buildUser({
        primaryProvider: 'google',
        linkedAccounts: [linkedAccount('google'), linkedAccount('github')],
      });

    it('should drop the account and move primary to what is left', async () => {
      const user = twoProviderUser();
      resolveUser(user);

      const result = await service.unlinkProvider(USER_ID, 'google');

      expect(result.linkedAccounts.map((account) => account.provider)).toEqual([
        'github',
      ]);
      expect(result.primaryProvider).toBe('github');
      expect(user.save).toHaveBeenCalled();
    });

    it('should refuse to unlink email sign-in', async () => {
      resolveUser(twoProviderUser());

      await expect(
        service.unlinkProvider(USER_ID, EMAIL_PROVIDER),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        status: 400,
      });
    });

    it('should reject a provider that is not linked', async () => {
      resolveUser(twoProviderUser());

      await expect(
        service.unlinkProvider(USER_ID, 'facebook'),
      ).rejects.toMatchObject({
        code: ErrorCode.PROVIDER_NOT_LINKED,
        status: 400,
      });
    });

    it('should keep the last sign-in method', async () => {
      const user = buildUser({
        authProvider: 'google',
        primaryProvider: 'google',
        linkedAccounts: [linkedAccount('google')],
      });
      user.linkedProviders = ['google'];
      resolveUser(user);

      await expect(
        service.unlinkProvider(USER_ID, 'google'),
      ).rejects.toMatchObject({
        code: ErrorCode.CANNOT_UNLINK_LAST_PROVIDER,
        status: 400,
      });
      expect(user.save).not.toHaveBeenCalled();
    });
  });
});
