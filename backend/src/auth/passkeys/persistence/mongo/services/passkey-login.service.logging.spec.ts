import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PasskeysModule } from '../../../passkeys.module';
import { Passkey, PasskeyDocument } from '../schemas/passkey.schema';
import { PasskeyLoginService } from '../../../services/passkey-login.service';
import { PasskeyChallengeService } from '../../../services/passkey-challenge.service';
import { CREDENTIAL_BODY, CREDENTIAL_ID } from '../passkeys.harness-spec';

jest.mock('@simplewebauthn/server', () => ({
  ...jest.requireActual<typeof import('@simplewebauthn/server')>(
    '@simplewebauthn/server',
  ),
  verifyAuthenticationResponse: jest.fn(),
}));
import {
  bootLoggingServices,
  LoggingServices,
  captureLogs,
  loggedCalls,
  createLoggingUser,
  LOGGING_USER_ID,
  loggingResponse,
} from '../../../../../../test/utils/logging-services';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../../test/utils/session-authority-harness';

describe('PasskeyLoginService logging with real repositories', () => {
  let fixture: LoggingServices;
  beforeAll(async () => {
    fixture = await bootLoggingServices([PasskeysModule]);
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
  async function prepare(userVerified: boolean) {
    // feature:totp:start
    await createLoggingUser(fixture, {
      twoFactor: {
        enabled: true,
        secret: null,
        recoveryCodes: [],
        lastUsedStep: null,
        confirmedAt: fixture.clock.now(),
      },
    });
    // feature:totp:end
    // Without TOTP, the same credential completes sign-in directly.
    if (!(await fixture.users.exists({ _id: LOGGING_USER_ID })))
      await createLoggingUser(fixture);
    const passkeys = fixture.module.get<Model<PasskeyDocument>>(
      getModelToken(Passkey.name),
    );
    await passkeys.create({
      user: new Types.ObjectId(LOGGING_USER_ID),
      credentialId: CREDENTIAL_ID,
      publicKey: Buffer.from([1, 2, 3]),
      counter: 0,
      name: 'Test key',
    });
    jest.mocked(verifyAuthenticationResponse).mockResolvedValue({
      verified: true,
      authenticationInfo: {
        credentialID: CREDENTIAL_ID,
        newCounter: 1,
        userVerified,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'http://localhost:3000',
        rpID: 'localhost',
      },
    });
    const context = loggingResponse();
    await fixture.module
      .get(PasskeyChallengeService)
      .issue(context.response, 'login', 'challenge');
    return context;
  }
  it('logs a passkey sign-in with the user id, never the address', async () => {
    const { request, response } = await prepare(true);
    const log = captureLogs();
    await fixture.module
      .get(PasskeyLoginService)
      .verify({ response: CREDENTIAL_BODY }, request, response);
    expect(loggedCalls(log)).toContain('userId=507f1f77bcf86cd799439011');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
  it('logs a passkey sign-in without an owed factor by user id', async () => {
    const { request, response } = await prepare(false);
    // feature:totp:start
    await fixture.users.updateOne(
      { _id: LOGGING_USER_ID },
      { $set: { 'twoFactor.enabled': false } },
    );
    // feature:totp:end
    const log = captureLogs();
    await fixture.module
      .get(PasskeyLoginService)
      .verify({ response: CREDENTIAL_BODY }, request, response);
    expect(loggedCalls(log)).toContain('userId=507f1f77bcf86cd799439011');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
  // feature:totp:start
  it('logs the second-factor branch with the user id, never the address', async () => {
    const { request, response } = await prepare(false);
    const log = captureLogs();
    await fixture.module
      .get(PasskeyLoginService)
      .verify({ response: CREDENTIAL_BODY }, request, response);
    expect(loggedCalls(log)).toContain('userId=507f1f77bcf86cd799439011');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
  // feature:totp:end
});
