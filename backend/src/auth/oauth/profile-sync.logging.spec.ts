import { ProfileSyncService } from '../../user/services/profile-sync.service';
import {
  bootLoggingServices,
  LoggingServices,
  captureLogs,
  loggedCalls,
  createLoggingUser,
  LOGGING_USER_ID,
  LOGGING_EMAIL,
} from '../../../test/utils/logging-services';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../test/utils/session-authority-harness';

describe('ProfileSyncService logging with real repositories', () => {
  let fixture: LoggingServices;
  beforeAll(async () => {
    fixture = await bootLoggingServices([]);
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  beforeEach(async () => {
    await fixture.reset();
  }, SESSION_AUTHORITY_RESET_TIMEOUT_MS);
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await fixture?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it('logs a name sync with the user id and provider, never the name', async () => {
    await createLoggingUser(fixture, { primaryProvider: 'google' });
    const log = captureLogs();
    await fixture.module
      .get(ProfileSyncService)
      .syncProfileFromProvider(LOGGING_USER_ID, 'google', {
        providerId: 'provider-id',
        emailVerified: true,
        email: LOGGING_EMAIL,
        name: 'New Name',
      });
    expect(loggedCalls(log)).toContain(
      'user 507f1f77bcf86cd799439011 from google',
    );
    expect(loggedCalls(log)).not.toContain('New Name');
  });
});
