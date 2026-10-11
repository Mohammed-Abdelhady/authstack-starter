jest.mock('otplib', () => ({
  ...jest.requireActual<typeof import('otplib')>('otplib'),
  verifySync: jest.fn(() => ({ valid: true, delta: 0 })),
}));
import * as bcrypt from 'bcrypt';
import { TwoFactorModule } from './two-factor.module';
import { TwoFactorService } from './two-factor.service';
import { TwoFactorLoginService } from './two-factor-login.service';
import { TotpSecretCryptoService } from './services/totp-secret-crypto.service';
import { TwoFactorChallengeService } from './services/two-factor-challenge.service';
import {
  bootLoggingServices,
  LoggingServices,
  captureLogs,
  loggedCalls,
  createLoggingUser,
  LOGGING_USER_ID,
  LOGGING_PASSWORD,
  LOGGING_ROUNDS,
  loggingResponse,
} from '../../../test/utils/logging-services';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../test/utils/session-authority-harness';

describe('TwoFactorService and TwoFactorLoginService logging with real repositories', () => {
  let fixture: LoggingServices;
  beforeAll(async () => {
    fixture = await bootLoggingServices([TwoFactorModule]);
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

  beforeEach(() => {
    jest
      .spyOn(Date, 'now')
      .mockImplementation(() => fixture.clock.now().getTime());
  });
  async function userWithFactor(enabled: boolean): Promise<void> {
    const secret = fixture.module
      .get(TotpSecretCryptoService)
      .encrypt('NYITGE7DZ7KUSQJFKLHJL2LZ6Z5IDTV7');
    await createLoggingUser(fixture, {
      password: await bcrypt.hash(LOGGING_PASSWORD, LOGGING_ROUNDS),
      twoFactor: {
        enabled,
        secret,
        confirmedAt: enabled ? fixture.clock.now() : null,
        recoveryCodes: [],
        lastUsedStep: null,
      },
    });
  }
  it('logs two-factor setup with the user id, never the address', async () => {
    await createLoggingUser(fixture, {
      password: await bcrypt.hash(LOGGING_PASSWORD, LOGGING_ROUNDS),
    });
    const log = captureLogs();
    await fixture.module
      .get(TwoFactorService)
      .setup(LOGGING_USER_ID, { password: LOGGING_PASSWORD }, undefined);
    expect(loggedCalls(log)).toContain('userId=507f1f77bcf86cd799439011');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
  it('logs the enabled factor with the user id, never the address', async () => {
    await userWithFactor(false);
    const log = captureLogs();
    await fixture.module
      .get(TwoFactorService)
      .confirm(LOGGING_USER_ID, { code: '123456' });
    expect(loggedCalls(log)).toContain('userId=507f1f77bcf86cd799439011');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
  it('logs the disabled factor with the user id, never the address', async () => {
    await userWithFactor(true);
    const log = captureLogs();
    await fixture.module
      .get(TwoFactorService)
      .disable(LOGGING_USER_ID, { code: '123456', password: LOGGING_PASSWORD });
    expect(loggedCalls(log)).toContain('userId=507f1f77bcf86cd799439011');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
  it('logs replaced recovery codes with the user id, never the address', async () => {
    await userWithFactor(true);
    const log = captureLogs();
    await fixture.module
      .get(TwoFactorService)
      .regenerateRecoveryCodes(LOGGING_USER_ID, { code: '123456' });
    expect(loggedCalls(log)).toContain('userId=507f1f77bcf86cd799439011');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
  it('logs the accepted second factor with the user id, never the address', async () => {
    await userWithFactor(true);
    const { request, response } = loggingResponse();
    await fixture.module
      .get(TwoFactorChallengeService)
      .issue(
        (await fixture.users.findById(LOGGING_USER_ID))!._id,
        response,
        'password',
      );
    const log = captureLogs();
    await fixture.module
      .get(TwoFactorLoginService)
      .verify({ code: '123456' }, request, response);
    expect(loggedCalls(log)).toContain('userId=507f1f77bcf86cd799439011');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
});
