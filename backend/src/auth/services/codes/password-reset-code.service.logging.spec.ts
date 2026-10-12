import { PasswordResetCodeService } from './password-reset-code.service';
import { runWithRequestContext } from '../../../common/context/request-context';
import {
  bootLoggingServices,
  LoggingServices,
  captureLogs,
  loggedCalls,
  LOGGING_EMAIL,
} from '../../../../test/utils/logging-services';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';

describe('PasswordResetCodeService logging with real repositories', () => {
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

  it('logs an opened reset with the request id, never the address', async () => {
    const service = fixture.module.get(PasswordResetCodeService);
    await service.createOrUpdatePasswordReset(LOGGING_EMAIL);
    const log = captureLogs();
    await runWithRequestContext('req-reset', () =>
      service.createOrUpdatePasswordReset(LOGGING_EMAIL),
    );
    expect(loggedCalls(log)).toContain('requestId=req-reset');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
  it('logs the created reset with the request id, never the address', async () => {
    const log = captureLogs();
    await runWithRequestContext('req-insert', () =>
      fixture.module
        .get(PasswordResetCodeService)
        .createOrUpdatePasswordReset(LOGGING_EMAIL),
    );
    expect(loggedCalls(log)).toContain('requestId=req-insert');
    expect(loggedCalls(log)).not.toContain('user@example.com');
  });
});
