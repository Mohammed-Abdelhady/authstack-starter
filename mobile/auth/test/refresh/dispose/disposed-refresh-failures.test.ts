import { describe, expect, it } from 'vitest';
import { HTTP_METHOD } from '@app/sdk';
import {
  CREDENTIAL_DELETE_TIMEOUT_MS,
  CREDENTIAL_WRITE_TIMEOUT_MS,
  OAUTH_REFRESH_TIMEOUT_MS,
} from '../../../src/constants';
import { createAuthEngine } from '../../support/engine';
import {
  REFRESH_TOKEN,
  CONFIG,
  Deferred,
  ScriptedTransport,
  establishSession,
  failedApiReply,
  testPorts,
} from '../../support/support';

describe('refresh answers after dispose', () => {
  it.each([
    ['throttle', failedApiReply(429, 'RATE_LIMIT_EXCEEDED'), 'stable'],
    ['authority unavailable', failedApiReply(503, 'AUTHORITY_UNAVAILABLE'), 'stable'],
    ['invalid grant', { status: 400, body: { error: 'invalid_grant' } }, 'deleted'],
    ['invalid client', { status: 401, body: { error: 'invalid_client' } }, 'deleted'],
  ] as const)(
    'applies only confirmed failure outcomes to the marker: %s',
    async (_name, answer, expected) => {
      const transport = new ScriptedTransport();
      const ports = testPorts(transport);
      const engine = createAuthEngine(CONFIG, ports);
      await establishSession(engine, ports, transport);
      ports.clock.advance(270_000);
      const started = new Deferred<void>();
      const networkSettled = new Deferred<void>();
      let sawRefreshTimer = false;
      let storageWriteStarted = false;
      let storageDeleteStarted = false;
      const storageOperationSettled = new Deferred<void>();
      ports.timer.onSchedule = (milliseconds) => {
        if (milliseconds === OAUTH_REFRESH_TIMEOUT_MS) sawRefreshTimer = true;
      };
      ports.timer.onCancel = (milliseconds) => {
        if (sawRefreshTimer && milliseconds === OAUTH_REFRESH_TIMEOUT_MS) networkSettled.resolve();
        if (storageWriteStarted && milliseconds === CREDENTIAL_WRITE_TIMEOUT_MS)
          storageOperationSettled.resolve();
        if (storageDeleteStarted && milliseconds === CREDENTIAL_DELETE_TIMEOUT_MS)
          storageOperationSettled.resolve();
      };
      const complete = new Deferred<void>();
      const guardRead = new Deferred<void>();
      const originalRead = ports.credentials.read.bind(ports.credentials);
      let disposed = false;
      ports.credentials.read = async () => {
        const result = await originalRead();
        if (disposed) guardRead.resolve();
        return result;
      };
      ports.credentials.beforeReplace = (value) => {
        if (
          expected === 'stable' &&
          value.includes(REFRESH_TOKEN) &&
          !value.includes('refreshInFlight')
        )
          storageWriteStarted = true;
        return Promise.resolve();
      };
      ports.credentials.beforeDelete = () => {
        if (expected === 'deleted') storageDeleteStarted = true;
        return Promise.resolve();
      };
      ports.credentials.afterReplace = (value) => {
        if (
          expected === 'stable' &&
          value.includes(REFRESH_TOKEN) &&
          !value.includes('refreshInFlight')
        )
          complete.resolve();
      };
      ports.credentials.afterDelete = () => {
        if (expected === 'deleted') complete.resolve();
      };
      transport.enqueue(() => {
        started.resolve();
        return Promise.resolve(answer);
      });
      const request = engine.transport.request({
        method: HTTP_METHOD.GET,
        path: '/api/user/profile',
      });
      await started.promise;
      disposed = true;
      engine.dispose();
      await expect(request).rejects.toMatchObject({ name: 'AuthDisposedError' });
      await networkSettled.promise;
      await guardRead.promise;
      await complete.promise;
      await storageOperationSettled.promise;

      if (expected === 'stable') {
        expect(ports.credentials.value).toContain(REFRESH_TOKEN);
        expect(ports.credentials.value).not.toContain('"refreshInFlight":true');
      } else {
        expect(ports.credentials.value).toBeUndefined();
      }
      const restarted = testPorts(new ScriptedTransport());
      restarted.credentials = ports.credentials;
      restarted.install = ports.install;
      const nextEngine = createAuthEngine(CONFIG, restarted);
      await expect(nextEngine.restore()).resolves.toMatchObject({
        kind: 'restored',
        status: expected === 'deleted' ? 'signedOut' : 'signedIn',
      });
      nextEngine.dispose();
      expect(ports.timer.pendingDelays).toEqual([]);
    },
  );
});
