import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import { SEED_USER } from '../../constants/seed-users';
import {
  beginNativeAuthorization,
  createNativeApplication,
  pauseNextNativeAuthorizationRead,
  seedUserId,
} from '../../utils/native/native-authorize.fixtures';
import { bootE2eApp, loginAs, type E2eApp } from '../../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import { TEST_NOW } from '../../utils/frozen-clock';

interface ApiErrorBody {
  error: { code: string };
}

describe('native authorization claim races (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    e2e.app.get(ConfigService).set('auth.nativeEnabled', true);
    await createNativeApplication(e2e);
  });

  it('denial wins against a paused approval without creating a code', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const started = await beginNativeAuthorization(e2e);
    const gate = pauseNextNativeAuthorizationRead(e2e);

    try {
      const approval = browser
        .post('/api/oauth/authorize/approve')
        .send({
          transactionId: started.transactionId,
          expectedUserId: await seedUserId(e2e),
        })
        .then((response) => response);
      await gate.reached;
      const denial = await browser.post('/api/oauth/authorize/deny').send({
        transactionId: started.transactionId,
        expectedUserId: await seedUserId(e2e),
      });
      gate.release();
      const approvalResponse = await approval;

      expect(denial.status).toBe(200);
      expect(approvalResponse.status).toBe(404);
      expect((approvalResponse.body as ApiErrorBody).error.code).toBe(
        ErrorCode.NATIVE_TRANSACTION_EXPIRED,
      );
      const transaction = await e2e.state.native.authorizationRequest(
        started.transactionId,
      );
      expect(transaction?.consumed).toBe(true);
      expect(transaction?.codeHash).toBeUndefined();
    } finally {
      gate.release();
      gate.restore();
    }
  });

  it('approval wins against a paused denial and the denial gets expired', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const started = await beginNativeAuthorization(e2e);
    const gate = pauseNextNativeAuthorizationRead(e2e);

    try {
      const denial = browser
        .post('/api/oauth/authorize/deny')
        .send({
          transactionId: started.transactionId,
          expectedUserId: await seedUserId(e2e),
        })
        .then((response) => response);
      await gate.reached;
      const approval = await browser.post('/api/oauth/authorize/approve').send({
        transactionId: started.transactionId,
        expectedUserId: await seedUserId(e2e),
      });
      gate.release();
      const denialResponse = await denial;

      expect(approval.status).toBe(200);
      expect(denialResponse.status).toBe(404);
      expect((denialResponse.body as ApiErrorBody).error.code).toBe(
        ErrorCode.NATIVE_TRANSACTION_EXPIRED,
      );
      const transaction = await e2e.state.native.authorizationRequest(
        started.transactionId,
      );
      expect(transaction?.consumed).toBe(false);
      expect(typeof transaction?.codeHash).toBe('string');
    } finally {
      gate.release();
      gate.restore();
    }
  });

  it('only one of two approvals can claim a transaction', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const started = await beginNativeAuthorization(e2e);
    const gate = pauseNextNativeAuthorizationRead(e2e);

    try {
      const first = browser
        .post('/api/oauth/authorize/approve')
        .send({
          transactionId: started.transactionId,
          expectedUserId: await seedUserId(e2e),
        })
        .then((response) => response);
      await gate.reached;
      const second = await browser.post('/api/oauth/authorize/approve').send({
        transactionId: started.transactionId,
        expectedUserId: await seedUserId(e2e),
      });
      gate.release();
      const firstResponse = await first;

      expect(second.status).toBe(200);
      expect(firstResponse.status).toBe(404);
      expect((firstResponse.body as ApiErrorBody).error.code).toBe(
        ErrorCode.NATIVE_TRANSACTION_EXPIRED,
      );
      expect(
        await e2e.state.native.approvedAuthorizationRequestCount(
          started.transactionId,
        ),
      ).toBe(1);
    } finally {
      gate.release();
      gate.restore();
    }
  });
});
