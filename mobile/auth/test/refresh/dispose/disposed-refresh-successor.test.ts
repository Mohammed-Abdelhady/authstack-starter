import { REFRESH_SUCCESSOR_TOKEN, REFRESH_LATE_TOKEN } from '../../support/token-values';
import { describe, expect, it } from 'vitest';
import { createApiClient } from '@app/sdk';
import { OAUTH_REFRESH_TIMEOUT_MS } from '../../../src/constants';
import { AuthSessionError } from '../../../src/errors/errors';
import { parseStoredRecord } from '../../../src/storage/persistence';
import { createRefreshCoordinator } from '../../../src/refresh/refresh';
import { AuthRuntime } from '../../../src/runtime/runtime';
import { createAuthEngine } from '../../support/engine';
import {
  CONFIG,
  Deferred,
  ScriptedTransport,
  acceptCode,
  establishSession,
  oauthTokenReply,
  successUserReply,
  testPorts,
} from '../../support/support';

describe('a disposed refresh and a successor engine', () => {
  it('revokes a late pair when a new sign-in owns the successor record', async () => {
    const oldTransport = new ScriptedTransport();
    const oldPorts = testPorts(oldTransport);
    const bootstrap = createAuthEngine(CONFIG, oldPorts);
    await establishSession(bootstrap, oldPorts, oldTransport);
    const serialized = oldPorts.credentials.value;
    if (!serialized) throw new Error('Expected the established session record');
    const record = parseStoredRecord(serialized);
    if (!record?.tokens || !record.lineageId)
      throw new Error('Expected the established refresh token and lineage');
    bootstrap.dispose();
    const oldRuntime = new AuthRuntime(CONFIG, oldPorts);
    oldRuntime.installDigest = record.installDigest;
    oldRuntime.record = record;
    oldRuntime.tokens = {
      accessToken: 'access-before-refresh',
      refreshToken: record.tokens.refreshToken,
      expiresAt: 0,
      version: 1,
      lineageId: record.lineageId,
    };
    oldRuntime.setState('signedIn', 'none');
    oldPorts.clock.advance(270_000);
    const refreshAnswer = new Deferred<ReturnType<typeof oauthTokenReply>>();
    const refreshStarted = new Deferred<void>();
    oldTransport.respond = async ({ path }) => {
      if (path === '/api/oauth/token') {
        refreshStarted.resolve();
        return refreshAnswer.promise;
      }
      throw new Error(`Unexpected request: ${path}`);
    };
    const client = createApiClient(oldRuntime.rawTransport);
    const coordinator = createRefreshCoordinator(oldRuntime, client, client);
    const refresh = coordinator.refresh();
    await refreshStarted.promise;
    oldRuntime.dispose();
    expect(oldPorts.timer.pendingDelays).toContain(OAUTH_REFRESH_TIMEOUT_MS);

    const newTransport = new ScriptedTransport();
    const newPorts = testPorts(newTransport);
    newPorts.crypto.randomBytes = async (length) => new Uint8Array(length).fill(9);
    newPorts.credentials = oldPorts.credentials;
    newPorts.install = oldPorts.install;
    const newEngine = createAuthEngine(CONFIG, newPorts);
    await newEngine.restore();
    newTransport.respond = async ({ path }) => {
      if (path === '/api/oauth/revoke') return { status: 200, body: {} };
      if (path === '/api/oauth/token')
        return oauthTokenReply('access-successor', REFRESH_SUCCESSOR_TOKEN);
      return successUserReply();
    };
    acceptCode(newPorts.authBrowser);
    await expect(newEngine.signIn()).resolves.toMatchObject({ kind: 'signedIn' });
    const successorRecord = oldPorts.credentials.value;

    refreshAnswer.resolve(oauthTokenReply('access-late', REFRESH_LATE_TOKEN));
    await expect(refresh).rejects.toBeInstanceOf(AuthSessionError);

    expect(oldPorts.credentials.value).toBe(successorRecord);
    const revocations = oldTransport.sent.filter(({ path }) => path === '/api/oauth/revoke');
    expect(revocations).toHaveLength(1);
    expect(revocations[0]?.body).toEqual({
      client_id: 'native-client',
      token: REFRESH_LATE_TOKEN,
    });
    expect(oldPorts.timer.pending).toBe(0);
    expect(newEngine.snapshot.status).toBe('signedIn');
  });
});
