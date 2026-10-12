import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth.service';
import {
  bootLoggingServices,
  LoggingServices,
  captureLogs,
  loggedCalls,
  createLoggingUser,
  LOGGING_EMAIL,
  LOGGING_PASSWORD,
  LOGGING_ROUNDS,
  loggingResponse,
} from '../../../test/utils/logging-services';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../test/utils/session-authority-harness';

describe('AuthService second-factor logging with real repositories', () => {
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

  it('logs an accepted password awaiting a second factor with the user id, never the address', async () => {
    jest
      .spyOn(Date, 'now')
      .mockImplementation(() => fixture.clock.now().getTime());
    await createLoggingUser(fixture, {
      password: await bcrypt.hash(LOGGING_PASSWORD, LOGGING_ROUNDS),
      twoFactor: { enabled: true },
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
});
