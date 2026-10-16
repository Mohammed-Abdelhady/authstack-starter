import { describe, expect, it } from 'vitest';
import { ApiError, OAuthError, TransportError, TRANSPORT_FAILURE } from '@app/sdk';
import { createAuthEngine } from '../support/engine';
import {
  CHALLENGE_NONCE,
  challengeThen,
  dpopChallenge,
  dpopTokenReply,
  establishBoundSession,
  proofNonces,
  requestPayload,
} from '../support/device-bound-support';
import { expectOnlyPendingRevocation } from '../support/pending-revocation';
import { SoftwareDeviceKey } from '../support/software-device-key';
import {
  CONFIG,
  Deferred,
  REFRESH_TOKEN,
  REVOKE_TIMEOUT_MS,
  ScriptedTransport,
  acceptCode,
  failedApiReply,
  testPorts,
  type TransportStep,
} from '../support/support';
import { revokedTokens } from '../support/tracking';

const revokeRequests = (transport: ScriptedTransport) =>
  transport.sent.filter(({ path }) => path === '/api/oauth/revoke');

describe('device-bound revocation', () => {
  it('revokes with a proof and retries one nonce challenge with a fresh proof', async () => {
    const { engine, transport } = await establishBoundSession();
    transport.enqueue(
      {
        status: 400,
        body: { error: 'use_dpop_nonce' },
        headers: { 'DPoP-Nonce': 'revoke-nonce' },
      },
      { status: 200, body: {} },
    );

    const outcome = await engine.signOut();

    const revokeRequests = transport.sent.filter(({ path }) => path === '/api/oauth/revoke');
    expect(outcome.kind).toBe('signedOut');
    expect(outcome.kind === 'signedOut' ? outcome.revocation : undefined).toBe('revoked');
    expect(revokeRequests).toHaveLength(2);
    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN, REFRESH_TOKEN]);
    expect(requestPayload(revokeRequests[0]?.headers?.['DPoP'] ?? '').ath).toEqual(
      expect.any(String),
    );
    expect(requestPayload(revokeRequests[1]?.headers?.['DPoP'] ?? '').nonce).toBe('revoke-nonce');
    expect(requestPayload(revokeRequests[0]?.headers?.['DPoP'] ?? '').jti).not.toBe(
      requestPayload(revokeRequests[1]?.headers?.['DPoP'] ?? '').jti,
    );
  });

  it('uses the binding proof when a profile failure revokes an exchanged session', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport, new SoftwareDeviceKey());
    transport.enqueue(
      ...challengeThen(dpopTokenReply()),
      failedApiReply(500, 'INTERNAL_ERROR'),
      ...challengeThen({ status: 200, body: {} }),
    );
    acceptCode(ports.authBrowser, 'profile-failure-code');
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    const outcome = await engine.signIn();
    const profile = transport.sent.find(({ path }) => path === '/api/user/profile');

    expect(outcome.kind).toBe('apiFailure');
    expect(profile?.headers?.['DPoP']).toBeUndefined();
    expect(proofNonces(revokeRequests(transport))).toEqual(['', CHALLENGE_NONCE]);
    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN, REFRESH_TOKEN]);
  });

  it.each([
    ['a lost answer', new TransportError(TRANSPORT_FAILURE.NO_RESPONSE), TransportError],
    ['an unavailable authority', failedApiReply(503, 'AUTHORITY_UNAVAILABLE'), ApiError],
  ] as const satisfies readonly (readonly [string, TransportStep, unknown])[])(
    'signs out here and reports the revoke as failed after a challenge then %s',
    async (_name, step, errorType) => {
      const { engine, ports, transport } = await establishBoundSession();
      transport.enqueue(...challengeThen(step));

      const outcome = await engine.signOut();

      expect(outcome).toMatchObject({ kind: 'signedOut', revocation: 'failed' });
      expect(outcome.error).toBeInstanceOf(errorType);
      expect(proofNonces(revokeRequests(transport))).toEqual(['', CHALLENGE_NONCE]);
      expect(engine.snapshot).toEqual({ status: 'signedOut', operation: 'none' });
      await expectOnlyPendingRevocation(ports, {
        refreshToken: REFRESH_TOKEN,
        attempts: 1,
        bound: true,
      });
    },
  );

  it('answers a second challenge in a row and revokes', async () => {
    const { engine, transport } = await establishBoundSession();
    transport.enqueue(...challengeThen(dpopChallenge('server-nonce-1'), { status: 200, body: {} }));

    const outcome = await engine.signOut();

    expect(outcome).toEqual({ kind: 'signedOut', revocation: 'revoked' });
    expect(proofNonces(revokeRequests(transport))).toEqual(['', CHALLENGE_NONCE, 'server-nonce-1']);
  });

  it('signs out here and reports the revoke as failed after the third challenge in a row', async () => {
    const { engine, ports, transport } = await establishBoundSession();
    transport.enqueue(
      ...challengeThen(dpopChallenge('server-nonce-1'), dpopChallenge('server-nonce-2')),
    );

    const outcome = await engine.signOut();

    expect(outcome).toMatchObject({ kind: 'signedOut', revocation: 'failed' });
    expect(outcome.error).toBeInstanceOf(OAuthError);
    expect(proofNonces(revokeRequests(transport))).toEqual(['', CHALLENGE_NONCE, 'server-nonce-1']);
    await expectOnlyPendingRevocation(ports, {
      refreshToken: REFRESH_TOKEN,
      attempts: 1,
      bound: true,
    });
  });

  it('times the revoke out when the answer to the challenged retry never comes', async () => {
    const { engine, ports, transport } = await establishBoundSession();
    const retrySent = new Deferred<void>();
    transport.enqueue(...challengeThen(() => new Promise(() => undefined)));
    transport.onRequest = () => {
      if (revokeRequests(transport).length === 2) retrySent.resolve();
    };

    const signOut = engine.signOut();
    await retrySent.promise;
    const waitingOn = ports.timer.pendingDelays;
    ports.timer.fireDelay(REVOKE_TIMEOUT_MS);

    await expect(signOut).resolves.toEqual({ kind: 'signedOut', revocation: 'timedOut' });
    expect(waitingOn).toEqual([REVOKE_TIMEOUT_MS]);
    expect(revokeRequests(transport)).toHaveLength(2);
    expect(transport.sent.at(-1)?.signal?.aborted).toBe(true);
    await expectOnlyPendingRevocation(ports, {
      refreshToken: REFRESH_TOKEN,
      attempts: 1,
      bound: true,
    });
  });
});
