import { REFRESH_BEFORE_TOKEN } from '../../support/token-values';
import { createApiClient, OAuthError } from '@app/sdk';
import type { Transport } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import type { AbortSignalPort } from '../../../src';
import { createRefreshCoordinator } from '../../../src/refresh/refresh';
import { makeRefreshRecord } from '../../../src/refresh/refresh-helpers';
import { AuthRuntime } from '../../../src/runtime/runtime';
import type { RuntimeTokens } from '../../../src/types/record';
import { CONFIG, Deferred, ScriptedTransport, testPorts } from '../../support/support';

describe('OAuth failures after dispose', () => {
  const lineageId = 'disposed-oauth-lineage';
  it.each([
    ['server_error', 'kept'],
    ['invalid_grant', 'deleted'],
  ] as const)(
    '%s changes the stored family only when it proves it is dead',
    async (code, expected) => {
      const transport = new ScriptedTransport();
      const ports = testPorts(transport);
      const runtime = new AuthRuntime(CONFIG, ports);
      const tokens: RuntimeTokens = {
        accessToken: 'access-before',
        refreshToken: REFRESH_BEFORE_TOKEN,
        expiresAt: 0,
        version: 1,
        lineageId,
      };
      runtime.installDigest = 'install-digest';
      runtime.tokens = tokens;
      runtime.record = makeRefreshRecord(runtime, 'install-digest', tokens);
      runtime.setState('signedIn', 'none');
      ports.credentials.value = JSON.stringify(runtime.record);
      const started = new Deferred<void>();
      transport.enqueue(() => {
        started.resolve();
        return Promise.resolve({ status: 400, body: { error: code } });
      });
      const tracked: Transport<AbortSignalPort> = {
        request: (request) => {
          if (request.path === '/api/oauth/token') {
            runtime.lastOAuthTokenSentAt = runtime.monotonicTime();
            runtime.oauthTokenRequestSent = true;
          }
          return transport.request(request);
        },
      };
      const client = createApiClient(tracked);
      const refresh = createRefreshCoordinator(runtime, client, client).refresh();
      await started.promise;
      runtime.dispose();

      await expect(refresh).rejects.toBeInstanceOf(OAuthError);

      if (expected === 'kept') {
        expect(ports.credentials.value).toBeDefined();
        expect(ports.credentials.value).toContain('"refreshInFlight":true');
        expect(ports.credentials.value).toContain(REFRESH_BEFORE_TOKEN);
      } else {
        expect(ports.credentials.value).toBeUndefined();
      }
      expect(ports.credentials.events.filter((event) => event === 'read')).toHaveLength(
        expected === 'deleted' ? 1 : 0,
      );
      expect(transport.sent.filter(({ path }) => path === '/api/oauth/revoke')).toHaveLength(0);
      expect(ports.timer.pending).toBe(0);
    },
  );
});
