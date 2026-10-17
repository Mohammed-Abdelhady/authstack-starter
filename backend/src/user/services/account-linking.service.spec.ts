import { AccountLinkingService } from './account-linking.service';
import { ErrorCode } from '../../common/enums/error-code.enum';
import {
  buildUser,
  createHarness,
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
    // An account made with Apple's relay address must be able to add Google,
    // but only on the reauthenticated path; the default keeps the rule.

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

  describe('unlinkProvider', () => {});
});
