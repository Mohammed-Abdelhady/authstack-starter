import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PasswordResetCodeService } from './services/codes/password-reset-code.service';
import {
  bootLoggingServices,
  LoggingServices,
  captureLogs,
  loggedCalls,
  createLoggingUser,
  LOGGING_EMAIL,
  LOGGING_PASSWORD,
  LOGGING_ROUNDS,
  LOGGING_NEW_PASSWORD,
  loggingResponse,
} from '../../test/utils/logging-services';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../test/utils/session-authority-harness';

describe('AuthService logging with real repositories', () => {
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

  it('logs a sign-in with the user id, never the address', async () => {
    await createLoggingUser(fixture, {
      password: await bcrypt.hash(LOGGING_PASSWORD, LOGGING_ROUNDS),
    });
    const log = captureLogs();
    await fixture.module
      .get(AuthService)
      .login(
        { email: LOGGING_EMAIL, password: LOGGING_PASSWORD },
        loggingResponse().response,
      );
    expect(loggedCalls(log)).toContain('userId=507f1f77bcf86cd799439011');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
  it('logs a password reset with the user id, never the address', async () => {
    await createLoggingUser(fixture, {
      password: await bcrypt.hash(LOGGING_PASSWORD, LOGGING_ROUNDS),
    });
    const code = await fixture.module
      .get(PasswordResetCodeService)
      .createOrUpdatePasswordReset(LOGGING_EMAIL);
    const log = captureLogs();
    await fixture.module.get(AuthService).resetPassword({
      email: LOGGING_EMAIL,
      code,
      newPassword: LOGGING_NEW_PASSWORD,
    });
    expect(loggedCalls(log)).toContain('Password reset successful');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
});
