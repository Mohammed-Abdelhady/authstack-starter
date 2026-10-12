import { AccountLinkingService } from './account-linking.service';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { EMAIL_PROVIDER } from '../../common/constants/oauth-providers';
import {
  buildUser,
  createHarness,
  linkedAccount,
  USER_ID,
  type MockUser,
} from '../persistence/mongo/services/account-linking.harness-spec';

describe('AccountLinkingService queries', () => {
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

  describe('getLinkedProviders', () => {
    it('should list email sign-in alongside the OAuth providers', async () => {
      resolveUser(buildUser({ linkedAccounts: [linkedAccount('google')] }));

      await expect(service.getLinkedProviders(USER_ID)).resolves.toEqual([
        EMAIL_PROVIDER,
        'google',
      ]);
    });

    it('should reject a missing user', async () => {
      resolveUser(null);

      await expect(service.getLinkedProviders(USER_ID)).rejects.toMatchObject({
        code: ErrorCode.USER_NOT_FOUND,
        status: 404,
      });
    });
  });

  describe('canUnlinkProvider', () => {
    // feature:email-password:start
    it('should allow a linked provider while another method remains', async () => {
      resolveUser(buildUser({ linkedAccounts: [linkedAccount('google')] }));

      await expect(service.canUnlinkProvider(USER_ID, 'google')).resolves.toBe(
        true,
      );
    });
    // feature:email-password:end

    it('should never allow unlinking email sign-in', async () => {
      resolveUser(buildUser());

      await expect(
        service.canUnlinkProvider(USER_ID, EMAIL_PROVIDER),
      ).resolves.toBe(false);
    });

    it('should answer false for a provider that is not linked', async () => {
      resolveUser(buildUser());

      await expect(service.canUnlinkProvider(USER_ID, 'github')).resolves.toBe(
        false,
      );
    });

    it('should answer false for a missing user rather than throw', async () => {
      resolveUser(null);

      await expect(service.canUnlinkProvider(USER_ID, 'google')).resolves.toBe(
        false,
      );
    });
  });

  describe('isPrimaryProvider', () => {
    it('should compare against the stored primary provider', async () => {
      resolveUser(buildUser({ primaryProvider: 'google' }));

      await expect(service.isPrimaryProvider(USER_ID, 'google')).resolves.toBe(
        true,
      );
      await expect(service.isPrimaryProvider(USER_ID, 'github')).resolves.toBe(
        false,
      );
    });

    it('should answer false for a soft deleted user', async () => {
      resolveUser(buildUser({ primaryProvider: 'google', isDeleted: true }));

      await expect(service.isPrimaryProvider(USER_ID, 'google')).resolves.toBe(
        false,
      );
    });
  });

  describe('setPrimaryProvider', () => {
    it('should switch to a linked provider', async () => {
      const user = buildUser({ linkedAccounts: [linkedAccount('google')] });
      resolveUser(user);

      const result = await service.setPrimaryProvider(USER_ID, 'google');

      expect(result.primaryProvider).toBe('google');
      expect(user.save).toHaveBeenCalled();
    });

    it('should refuse email sign-in, which has no profile to sync', async () => {
      resolveUser(buildUser());

      await expect(
        service.setPrimaryProvider(USER_ID, EMAIL_PROVIDER),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        status: 400,
      });
    });

    it('should refuse a provider that is not linked', async () => {
      const user = buildUser();
      resolveUser(user);

      await expect(
        service.setPrimaryProvider(USER_ID, 'github'),
      ).rejects.toMatchObject({
        code: ErrorCode.PROVIDER_NOT_LINKED,
        status: 400,
      });
      expect(user.save).not.toHaveBeenCalled();
    });
  });
});
