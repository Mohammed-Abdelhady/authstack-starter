import { describe, expect, it } from 'vitest';
import { TransportError, TRANSPORT_FAILURE } from '@app/sdk';
import { createAuthEngine } from '../support/engine';
import {
  CHALLENGE_NONCE,
  challengeThen,
  dpopChallenge,
  dpopTokenReply,
  proofNonces,
  requestPayload as payloadOf,
} from '../support/device-bound-support';
import { SoftwareDeviceKey } from '../support/software-device-key';
import {
  CONFIG,
  ScriptedTransport,
  acceptCode,
  failedApiReply,
  successUserReply,
  testPorts,
  type TransportStep,
} from '../support/support';

const tokenRequests = (transport: ScriptedTransport) =>
  transport.sent.filter(({ path }) => path === '/api/oauth/token');

describe('device-bound code exchange', () => {
  it('answers the challenge with a second proof and saves the binding thumbprint with the session', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport, new SoftwareDeviceKey());
    transport.enqueue(...challengeThen(dpopTokenReply()), successUserReply());
    acceptCode(ports.authBrowser, 'bound-code');
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    const outcome = await engine.signIn();
    const proofs = tokenRequests(transport).map(({ headers }) =>
      payloadOf(headers?.['DPoP'] ?? ''),
    );

    expect(outcome.kind).toBe('signedIn');
    expect(proofs.map(({ htm, htu, ath }) => ({ htm, htu, ath }))).toEqual([
      { htm: 'POST', htu: 'https://api.example.test/api/oauth/token', ath: undefined },
      { htm: 'POST', htu: 'https://api.example.test/api/oauth/token', ath: undefined },
    ]);
    expect(proofNonces(tokenRequests(transport))).toEqual(['', CHALLENGE_NONCE]);
    expect(ports.credentials.value).toContain(
      '"proofKeyThumbprint":"paWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaU"',
    );
    expect(ports.credentials.value).toContain('"lineageId"');
  });

  it('retries one nonce challenge with the same code and a fresh proof id', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport, new SoftwareDeviceKey());
    transport.enqueue(
      { status: 400, body: { error: 'use_dpop_nonce' }, headers: { 'DPoP-Nonce': 'server-nonce' } },
      dpopTokenReply(),
      successUserReply(),
    );
    acceptCode(ports.authBrowser, 'nonce-code');
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    const outcome = await engine.signIn();
    const requests = transport.sent.filter(({ path }) => path === '/api/oauth/token');
    const firstBody = requests[0]?.body;
    const secondBody = requests[1]?.body;

    expect(outcome.kind).toBe('signedIn');
    expect(requests).toHaveLength(2);
    expect(firstBody).toEqual(secondBody);
    expect(payloadOf(requests[1]?.headers?.['DPoP'] ?? '').nonce).toBe('server-nonce');
    expect(payloadOf(requests[0]?.headers?.['DPoP'] ?? '').jti).not.toBe(
      payloadOf(requests[1]?.headers?.['DPoP'] ?? '').jti,
    );
  });

  it('answers a second challenge in a row and signs in', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport, new SoftwareDeviceKey());
    transport.enqueue(
      ...challengeThen(dpopChallenge('nonce-2'), dpopTokenReply()),
      successUserReply(),
    );
    acceptCode(ports.authBrowser, 'twice-code');
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    const outcome = await engine.signIn();

    expect(outcome.kind).toBe('signedIn');
    expect(proofNonces(tokenRequests(transport))).toEqual(['', CHALLENGE_NONCE, 'nonce-2']);
  });

  it('stops after the third challenge in a row', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport, new SoftwareDeviceKey());
    transport.enqueue(...challengeThen(dpopChallenge('nonce-2'), dpopChallenge('nonce-3')));
    acceptCode(ports.authBrowser, 'loop-code');
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    const outcome = await engine.signIn();

    expect(outcome.kind).toBe('oauthFailure');
    expect(proofNonces(tokenRequests(transport))).toEqual(['', CHALLENGE_NONCE, 'nonce-2']);
    expect(transport.sent).toHaveLength(3);
    expect(ports.credentials.value).toBeUndefined();
  });

  it.each([
    ['a lost answer', new TransportError(TRANSPORT_FAILURE.NO_RESPONSE), 'transportFailure'],
    ['a 502', failedApiReply(502, 'BAD_GATEWAY'), 'apiFailure'],
    ['an unavailable authority', failedApiReply(503, 'AUTHORITY_UNAVAILABLE'), 'apiFailure'],
    ['a full session cap', { status: 400, body: { error: 'access_denied' } }, 'oauthFailure'],
    ['a spent code', { status: 400, body: { error: 'invalid_grant' } }, 'oauthFailure'],
  ] as const satisfies readonly (readonly [string, TransportStep, string])[])(
    'ends the sign-in after a challenge then %s, without sending the code a third time',
    async (_name, step, kind) => {
      const transport = new ScriptedTransport();
      const ports = testPorts(transport, new SoftwareDeviceKey());
      transport.enqueue(...challengeThen(step));
      acceptCode(ports.authBrowser, 'failing-code');
      const engine = createAuthEngine(CONFIG, ports);
      await engine.restore();

      const outcome = await engine.signIn();

      expect(outcome.kind).toBe(kind);
      expect(proofNonces(tokenRequests(transport))).toEqual(['', CHALLENGE_NONCE]);
      expect(transport.sent).toHaveLength(2);
      expect(engine.snapshot.status).toBe('signedOut');
      expect(ports.credentials.value).toBeUndefined();
    },
  );
});
