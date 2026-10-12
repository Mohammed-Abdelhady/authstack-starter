import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MailDispatcherService } from '../../../../mail/mail-dispatcher.service';
import { MagicLinkModule } from '../../magic-link.module';
import { MagicLinkService } from '../../magic-link.service';
import {
  PendingMagicLink,
  PendingMagicLinkDocument,
} from './schemas/pending-magic-link.schema';
import { hashMagicLinkToken } from '../../utils/magic-link-token.util';
import { runWithRequestContext } from '../../../../common/context/request-context';
import {
  bootLoggingServices,
  LoggingServices,
  captureLogs,
  loggedCalls,
  createLoggingUser,
  LOGGING_EMAIL,
  loggingResponse,
} from '../../../../../test/utils/logging-services';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../test/utils/session-authority-harness';

const MAGIC_LINK_TOKEN = 'a-token-from-the-mailed-link';
const MAGIC_LINK_EXPIRES_AT = '2099-01-01T12:01:00.000Z';

describe('MagicLinkService logging with real repositories', () => {
  let fixture: LoggingServices;
  beforeAll(async () => {
    fixture = await bootLoggingServices([MagicLinkModule]);
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

  it('logs a sent link with the request id, never the address', async () => {
    const log = captureLogs();
    await runWithRequestContext('req-ml', () =>
      fixture.module
        .get(MagicLinkService)
        .request(
          { email: LOGGING_EMAIL },
          loggingResponse().request,
          loggingResponse().response,
        ),
    );
    await fixture.module.get(MailDispatcherService).flush();
    expect(log).toHaveBeenCalled();
    expect(loggedCalls(log)).toContain('Magic link sent requestId=req-ml');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
  it('warns a capped address with the request id, never the address', async () => {
    for (let mailed = 0; mailed < 5; mailed += 1) {
      await fixture.module
        .get(MagicLinkService)
        .request(
          { email: LOGGING_EMAIL },
          loggingResponse().request,
          loggingResponse().response,
        );
    }
    const log = captureLogs();
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    await runWithRequestContext('req-cap', () =>
      fixture.module
        .get(MagicLinkService)
        .request(
          { email: LOGGING_EMAIL },
          loggingResponse().request,
          loggingResponse().response,
        ),
    );
    expect(warn).toHaveBeenCalled();
    expect(loggedCalls(log, warn)).toContain('requestId=req-cap');
    expect(loggedCalls(log, warn)).not.toContain('user@example.com');
  });
  it('logs a spent link with the user id, never the address', async () => {
    await createLoggingUser(fixture);
    const pending = fixture.module.get<Model<PendingMagicLinkDocument>>(
      getModelToken(PendingMagicLink.name),
    );
    await pending.create({
      email: LOGGING_EMAIL,
      tokenHash: hashMagicLinkToken(MAGIC_LINK_TOKEN),
      createdAt: fixture.clock.now(),
      expiresAt: new Date(MAGIC_LINK_EXPIRES_AT),
    });
    const log = captureLogs();
    await fixture.module
      .get(MagicLinkService)
      .verify(
        { token: MAGIC_LINK_TOKEN, confirm: true },
        loggingResponse().request,
        loggingResponse().response,
      );
    expect(loggedCalls(log)).toContain('userId=507f1f77bcf86cd799439011');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
  // feature:totp:start
  it('logs a spent link awaiting a second factor with the user id, never the address', async () => {
    jest
      .spyOn(Date, 'now')
      .mockImplementation(() => fixture.clock.now().getTime());
    await createLoggingUser(fixture, { twoFactor: { enabled: true } });
    const pending = fixture.module.get<Model<PendingMagicLinkDocument>>(
      getModelToken(PendingMagicLink.name),
    );
    await pending.create({
      email: LOGGING_EMAIL,
      tokenHash: hashMagicLinkToken(MAGIC_LINK_TOKEN),
      createdAt: fixture.clock.now(),
      expiresAt: new Date(MAGIC_LINK_EXPIRES_AT),
    });
    const log = captureLogs();
    await fixture.module
      .get(MagicLinkService)
      .verify(
        { token: MAGIC_LINK_TOKEN, confirm: true },
        loggingResponse().request,
        loggingResponse().response,
      );
    expect(loggedCalls(log)).toContain('userId=507f1f77bcf86cd799439011');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
  // feature:totp:end
});
