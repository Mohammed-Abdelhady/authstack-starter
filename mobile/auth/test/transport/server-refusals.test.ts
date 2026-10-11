import { describe, expect, it } from 'vitest';
import { ApiError, HTTP_METHOD, OAuthError } from '@app/sdk';
import { createAuthEngine } from '../support/engine';
import {
  CONFIG,
  REFRESH_TOKEN,
  ScriptedTransport,
  acceptCode,
  establishSession,
  failedApiReply,
  testPorts,
} from '../support/support';
import { revokedTokens } from '../support/tracking';

const PROFILE = { method: HTTP_METHOD.GET, path: '/api/user/profile' } as const;
/** What the token route answers when the account already holds its limit of sessions. */
const SESSION_CAP = { status: 400, body: { error: 'access_denied' } };
const AUTHORITY_DOWN = failedApiReply(503, 'AUTHORITY_UNAVAILABLE');
const OUTCOME_UNKNOWN = failedApiReply(503, 'TRANSACTION_OUTCOME_UNKNOWN');

async function signedIn() {
  const transport = new ScriptedTransport();
  const ports = testPorts(transport);
  const engine = createAuthEngine(CONFIG, ports);
  await establishSession(engine, ports, transport);
  return { transport, ports, engine };
}

const tokenRequests = (transport: ScriptedTransport) =>
  transport.sent.filter(({ path }) => path === '/api/oauth/token');

describe('refusals the server sends that the engine must not mistake for others', () => {
  it.each([
    ['a full session cap', SESSION_CAP, 'oauthFailure', OAuthError],
    ['an unavailable authority', AUTHORITY_DOWN, 'apiFailure', ApiError],
    ['an unknown transaction outcome', OUTCOME_UNKNOWN, 'apiFailure', ApiError],
  ] as const)(
    'ends the sign-in on %s, sends the code once and stores nothing',
    async (_name, reply, kind, errorType) => {
      const transport = new ScriptedTransport();
      transport.enqueue(reply);
      const ports = testPorts(transport);
      acceptCode(ports.authBrowser);
      const engine = createAuthEngine(CONFIG, ports);
      await engine.restore();

      const outcome = await engine.signIn();

      expect(outcome.kind).toBe(kind);
      expect('error' in outcome ? outcome.error : undefined).toBeInstanceOf(errorType);
      expect(transport.sent.map(({ path }) => path)).toEqual(['/api/oauth/token']);
      expect(engine.snapshot.status).toBe('signedOut');
      expect(ports.credentials.value).toBeUndefined();
    },
  );

  it('hands a 403 for the kill switch back to the caller, renews nothing and stays signed in', async () => {
    const { engine, ports, transport } = await signedIn();
    const stored = ports.credentials.value;
    transport.enqueue(failedApiReply(403, 'NATIVE_AUTH_DISABLED'));

    const response = await engine.transport.request(PROFILE);

    expect(response).toMatchObject({
      status: 403,
      body: { success: false, error: { code: 'NATIVE_AUTH_DISABLED' } },
    });
    expect(tokenRequests(transport)).toHaveLength(1);
    expect(engine.snapshot.status).toBe('signedIn');
    expect(ports.credentials.value).toBe(stored);
  });

  it.each([
    ['an unavailable authority', AUTHORITY_DOWN],
    ['an unknown transaction outcome', OUTCOME_UNKNOWN],
  ] as const)(
    'signs out on the device and reports the revoke as failed on %s',
    async (_name, reply) => {
      const { engine, ports, transport } = await signedIn();
      transport.enqueue(reply);

      const outcome = await engine.signOut();

      expect(outcome).toMatchObject({ kind: 'signedOut', revocation: 'failed' });
      expect(outcome.error).toBeInstanceOf(ApiError);
      expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN]);
      expect(engine.snapshot).toEqual({ status: 'signedOut', operation: 'none' });
      expect(ports.credentials.value).toBeUndefined();
    },
  );

  it('keeps the session after an unavailable authority on renewal, and loses nothing', async () => {
    const { engine, ports, transport } = await signedIn();
    ports.clock.advance(270_000);
    transport.enqueue(AUTHORITY_DOWN);

    await expect(engine.transport.request(PROFILE)).rejects.toMatchObject({
      status: 503,
      code: 'AUTHORITY_UNAVAILABLE',
    });

    expect(tokenRequests(transport)).toHaveLength(2);
    expect(engine.snapshot.status).toBe('signedIn');
    expect(ports.credentials.value).toContain(`"refreshToken":"${REFRESH_TOKEN}"`);
    expect(ports.credentials.value).not.toContain('refreshInFlight');
  });
});
