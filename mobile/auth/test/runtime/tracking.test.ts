import { REFRESH_TOKEN } from '../support/support';
import { describe, expect, it } from 'vitest';
import { HTTP_METHOD } from '@app/sdk';
import {
  allowRefreshReplayAfterThrottle,
  assertNoRefreshTokenReplay,
  registerTransport,
  type ScriptedRequestLog,
} from '../support/tracking';

describe('refresh replay test support', () => {
  it('detects a repeated refresh token across transport instances', () => {
    const beforeRestart: ScriptedRequestLog = { sent: [] };
    const afterRestart: ScriptedRequestLog = { sent: [] };
    const request = {
      method: HTTP_METHOD.POST,
      path: '/api/oauth/token',
      body: { grant_type: 'refresh_token', refresh_token: REFRESH_TOKEN },
    };
    beforeRestart.sent.push(request);
    afterRestart.sent.push(request);
    registerTransport(beforeRestart);
    registerTransport(afterRestart);

    expect(() => assertNoRefreshTokenReplay()).toThrow();
    allowRefreshReplayAfterThrottle(REFRESH_TOKEN);
    expect(() => assertNoRefreshTokenReplay()).not.toThrow();
  });
});
