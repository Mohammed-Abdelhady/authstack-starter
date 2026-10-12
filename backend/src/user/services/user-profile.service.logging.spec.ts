import * as bcrypt from 'bcrypt';
import { UserProfileService } from './user-profile.service';
import { UserPermissionsService } from './user-permissions.service';
import { SessionService } from '../../auth/persistence/mongo/session.service';
import {
  bootLoggingServices,
  LoggingServices,
  captureLogs,
  loggedCalls,
  createLoggingUser,
  LOGGING_USER_ID,
  LOGGING_PASSWORD,
  LOGGING_NEW_PASSWORD,
  LOGGING_ROUNDS,
} from '../../../test/utils/logging-services';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../test/utils/session-authority-harness';

describe('UserProfileService and UserPermissionsService logging with real repositories', () => {
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

  it('logs a profile read with the user id, never the address', async () => {
    await createLoggingUser(fixture);
    const log = captureLogs();
    await fixture.module.get(UserProfileService).getProfile(LOGGING_USER_ID);
    expect(loggedCalls(log)).toContain('userId=507f1f77bcf86cd799439011');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
  it('logs a profile update with the user id, never the address', async () => {
    await createLoggingUser(fixture);
    const log = captureLogs();
    await fixture.module
      .get(UserProfileService)
      .updateProfile(LOGGING_USER_ID, { name: 'New Name' });
    expect(loggedCalls(log)).toContain('userId=507f1f77bcf86cd799439011');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
  it('logs a password change with the user id, never the address', async () => {
    const user = await createLoggingUser(fixture, {
      password: await bcrypt.hash(LOGGING_PASSWORD, LOGGING_ROUNDS),
    });
    const sessions = fixture.module.get(SessionService);
    const issued = await sessions.createSession(
      user._id,
      'logging-test',
      '127.0.0.1',
    );
    const currentSession = await sessions.getSessionByToken(
      issued.sessionToken,
    );
    if (!currentSession) throw new Error('Issued session was not persisted');
    const log = captureLogs();
    await fixture.module.get(UserProfileService).changePassword(
      LOGGING_USER_ID,
      {
        currentPassword: LOGGING_PASSWORD,
        newPassword: LOGGING_NEW_PASSWORD,
      },
      currentSession._id.toString(),
    );
    expect(loggedCalls(log)).toContain('userId=507f1f77bcf86cd799439011');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
  it('logs a deactivated account with the user id, never the address', async () => {
    await createLoggingUser(fixture);
    const log = captureLogs();
    await fixture.module
      .get(UserProfileService)
      .deactivateAccount(LOGGING_USER_ID);
    expect(loggedCalls(log)).toContain('userId=507f1f77bcf86cd799439011');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
  it('logs a granted permission with the user id, never the address', async () => {
    await createLoggingUser(fixture);
    const log = captureLogs();
    await fixture.module
      .get(UserPermissionsService)
      .addPermission(LOGGING_USER_ID, 'users:read:all');
    expect(loggedCalls(log)).toContain('userId=507f1f77bcf86cd799439011');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
  it('logs a removed permission with the user id, never the address', async () => {
    await createLoggingUser(fixture, { permissions: ['users:read:all'] });
    const log = captureLogs();
    await fixture.module
      .get(UserPermissionsService)
      .removePermission(LOGGING_USER_ID, 'users:read:all');
    expect(loggedCalls(log)).toContain('userId=507f1f77bcf86cd799439011');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
});
