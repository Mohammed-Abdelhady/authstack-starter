import { describe, expect, it } from 'vitest';
import { createAuthEngine } from '../support/engine';
import {
  apiReply,
  CONFIG,
  failedApiReply,
  oauthTokenReply,
  ScriptedTransport,
  successUserReply,
  testPorts,
} from '../support/support';
import { ATTEMPT_ID, ATTEMPT_SECRET, NONCE_DIGEST } from './native-fixtures';

const EMAIL = 'person@example.test';
const RIGHT_CODE = '482913';
const WRONG_CODE = '482914';
const ATTEMPT_PATH = `/api/auth/native/attempts/${ATTEMPT_ID}`;
const LIFETIME_MS = 10 * 60_000;

function savedState(ports: ReturnType<typeof testPorts>): string {
  const saved = JSON.parse(ports.credentials.value ?? '{}') as { transaction?: { state?: string } };
  return saved.transaction?.state ?? '';
}

/** An attempt that was started for an emailed code and asked for one. */
async function codeRequested() {
  const transport = new ScriptedTransport();
  const ports = testPorts(transport);
  const expiresAt = new Date(ports.clock.wall + LIFETIME_MS).toISOString();
  const sent = apiReply({ attemptId: ATTEMPT_ID, stage: 'emailLinkSent', expiresAt, email: EMAIL });
  transport.enqueue(
    apiReply({
      attemptId: ATTEMPT_ID,
      attemptSecret: ATTEMPT_SECRET,
      providerNonceDigest: NONCE_DIGEST,
      stage: 'firstFactorRequired',
      expiresAt,
      factors: ['emailCode'],
    }),
    sent,
  );
  const engine = createAuthEngine(CONFIG, ports);
  await engine.restore();
  await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });
  const requested = await engine.nativeSignIn({
    kind: 'requestEmailCode',
    email: EMAIL,
    locale: 'en',
  });
  const codeReady = () =>
    Promise.resolve(
      apiReply({
        attemptId: ATTEMPT_ID,
        stage: 'codeReady',
        expiresAt,
        redirectUri: `${CONFIG.redirectUri}?code=issued-code&state=${savedState(ports)}`,
      }),
    );
  const denied = apiReply({
    attemptId: ATTEMPT_ID,
    stage: 'denied',
    expiresAt,
    reason: 'cancelled',
  });
  return { transport, ports, engine, sent, denied, requested, codeReady };
}

describe('native sign-in by emailed code', () => {
  it('refuses a wrong code without ending the attempt, then signs in with the right one', async () => {
    const { transport, ports, engine, sent, requested, codeReady } = await codeRequested();
    transport.enqueue(
      failedApiReply(400, 'EMAIL_CODE_INVALID'),
      sent,
      codeReady,
      oauthTokenReply(),
      successUserReply(),
    );

    const wrong = await engine.nativeSignIn({ kind: 'verifyEmailCode', code: WRONG_CODE });
    const waiting = engine.snapshot.nativeAttempt?.stage;
    const right = await engine.nativeSignIn({
      kind: 'verifyEmailCode',
      code: RIGHT_CODE,
      locale: 'en',
    });

    expect([requested.kind, wrong.kind, waiting, right.kind]).toEqual([
      'continue',
      'codeRefused',
      'emailLinkSent',
      'signedIn',
    ]);
    expect(transport.sent.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      expect.objectContaining({ method: 'POST', path: '/api/auth/native/attempts' }),
      {
        method: 'POST',
        path: `${ATTEMPT_PATH}/email-code/request`,
        body: { email: EMAIL, locale: 'en' },
      },
      { method: 'POST', path: `${ATTEMPT_PATH}/email-code/verify`, body: { code: WRONG_CODE } },
      { method: 'GET', path: ATTEMPT_PATH, body: undefined },
      {
        method: 'POST',
        path: `${ATTEMPT_PATH}/email-code/verify`,
        body: { code: RIGHT_CODE, locale: 'en' },
      },
      expect.objectContaining({ path: '/api/oauth/token' }),
      expect.objectContaining({ path: '/api/user/profile' }),
    ]);
    expect(transport.sent[4]?.headers?.['X-Native-Attempt']).toBe(ATTEMPT_SECRET);
    expect(ports.credentials.value).not.toContain(RIGHT_CODE);
  });

  it('asks for a new code on the same attempt and stops once the server ends it', async () => {
    const { transport, ports, engine, sent, denied } = await codeRequested();
    // The engine's own cancel of the ended attempt gets the same answer.
    transport.enqueue(
      failedApiReply(400, 'EMAIL_CODE_INVALID'),
      sent,
      sent,
      failedApiReply(400, 'EMAIL_CODE_INVALID'),
      denied,
      denied,
    );

    const first = await engine.nativeSignIn({ kind: 'verifyEmailCode', code: WRONG_CODE });
    const resent = await engine.nativeSignIn({ kind: 'requestEmailCode', email: EMAIL });
    const last = await engine.nativeSignIn({ kind: 'verifyEmailCode', code: WRONG_CODE });

    expect([first.kind, resent.kind, last.kind]).toEqual([
      'codeRefused',
      'continue',
      'codeAttemptEnded',
    ]);
    expect(
      transport.sent
        .filter(({ path }) => path.endsWith('/email-code/request'))
        .map(({ path }) => path),
    ).toEqual([`${ATTEMPT_PATH}/email-code/request`, `${ATTEMPT_PATH}/email-code/request`]);
    expect(transport.sent.filter(({ path }) => path === '/api/auth/native/attempts')).toHaveLength(
      1,
    );
    expect(engine.snapshot.nativeAttempt).toBeUndefined();
    expect(ports.credentials.value).toBeUndefined();
  });

  it('sends no code once the attempt has expired', async () => {
    const { transport, ports, engine, denied } = await codeRequested();
    transport.enqueue(denied);
    ports.clock.advance(LIFETIME_MS + 1);
    const before = transport.sent.length;

    const late = await engine.nativeSignIn({ kind: 'verifyEmailCode', code: RIGHT_CODE });

    expect(late.kind).toBe('expired');
    expect(transport.sent.slice(before).map(({ path }) => path)).not.toContain(
      `${ATTEMPT_PATH}/email-code/verify`,
    );
    expect(ports.credentials.value).toBeUndefined();
  });

  it('finishes the waiting attempt from the mail button, whose values follow #', async () => {
    const { transport, ports, engine, codeReady } = await codeRequested();
    const state = savedState(ports);
    const values = `native_attempt_id=${ATTEMPT_ID}&native_email_token=mail-token`;
    transport.enqueue(codeReady, oauthTokenReply(), successUserReply());
    const before = transport.sent.length;

    await ports.callbacks.deliver(`${CONFIG.redirectUri}#${values}&state=other-state`);
    const ignored = transport.sent.length - before;
    await ports.callbacks.deliver(`${CONFIG.redirectUri}#${values}&state=${state}`);

    expect(ignored).toBe(0);
    expect(transport.sent[before]).toMatchObject({
      path: `${ATTEMPT_PATH}/email-link/verify`,
      body: { token: 'mail-token', state },
    });
    expect(engine.snapshot.status).toBe('signedIn');
  });
});
