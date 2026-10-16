import {
  FAKE_SHA256,
  FakeCrypto,
  FakeLinking,
  FakeMarkerFile,
  FakeSecureStore,
  FakeServer,
  FakeTime,
  FakeUuid,
  FakeWebBrowser,
  oauthRefusal,
  SERVER_CODE,
  SERVER_PATH,
  serverRefusal,
  SERVER_USER,
} from '@app/native-adapters/testing';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/logic/resolve-config';
import { createShellAuth, type ShellAuth } from '../src/shell';

/** Written by hand: prefix, escaped client id, environment. */
const RECORD_KEY = 'auth.com_002eexample_002emobile.development';
/** The refresh token the fake server issues at the first sign-in. */
const SESSION_REFRESH_TOKEN = 'refresh-1';
/** The server's access tokens live 300 seconds and the engine renews 30 seconds early. */
const RENEW_AFTER_MS = 270_000;

/** What a restart keeps: the keychain, the install marker and the clock. */
interface KeptOnDevice {
  store: FakeSecureStore;
  installMarker: FakeMarkerFile;
  time: FakeTime;
}

function device(kept?: KeptOnDevice) {
  const store = kept?.store ?? new FakeSecureStore();
  const installMarker = kept?.installMarker ?? new FakeMarkerFile();
  const server = new FakeServer();
  const browser = new FakeWebBrowser();
  const time = kept?.time ?? new FakeTime();
  browser.respond = (url) => ({ type: 'success', url: server.authorize(url) });
  const app: ShellAuth = createShellAuth(
    {
      secureStore: store,
      keychainOptions: { keychainAccessible: 4 },
      webBrowser: browser,
      crypto: new FakeCrypto(),
      sha256Algorithm: FAKE_SHA256,
      linking: new FakeLinking(null),
      installMarker,
      recordMarker: new FakeMarkerFile(),
      uuid: new FakeUuid(),
      clock: time,
      timers: time,
      http: server,
    },
    {
      configuration: resolveConfig({
        apiOrigin: undefined,
        development: true,
        scheme: 'com.example.mobile',
      }),
      ephemeralBrowserSession: true,
    },
  );
  return { store, installMarker, server, browser, time, app };
}

/** The refresh tokens the stored value keeps for revocation, and whether it holds a session. */
function storedValue(store: FakeSecureStore) {
  const parsed: unknown = JSON.parse(store.items.get(RECORD_KEY) ?? '{}');
  if (typeof parsed !== 'object' || parsed === null) return { session: false, waiting: [] };
  const waiting =
    'pendingRevocations' in parsed && Array.isArray(parsed.pendingRevocations)
      ? parsed.pendingRevocations.map((entry: unknown) =>
          typeof entry === 'object' && entry !== null && 'refreshToken' in entry
            ? {
                refreshToken: entry.refreshToken,
                attempts: 'attempts' in entry ? entry.attempts : undefined,
              }
            : undefined,
        )
      : [];
  return { session: 'serverBaseAddress' in parsed || 'tokens' in parsed, waiting };
}

async function signedIn() {
  const parts = device();
  await parts.app.engine.restore();
  await parts.app.engine.signIn();
  return parts;
}

declare function setImmediate(callback: () => void): unknown;

/** Resolves once every continuation already queued has run. It waits on no duration. */
const queuedWorkDone = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

const paths = (server: FakeServer) => server.requests.map(({ path }) => path);

describe('signing in against a server that refuses or cannot be reached', () => {
  it.each([
    [
      'the session cap is full',
      (server: FakeServer) => server.failNext(SERVER_PATH.TOKEN, oauthRefusal('access_denied')),
      'oauthFailure',
    ],
    [
      'sign-in from the app is turned off',
      (server: FakeServer) =>
        server.failNext(
          SERVER_PATH.TOKEN,
          oauthRefusal('unauthorized_client', SERVER_CODE.NATIVE_AUTH_DISABLED),
        ),
      'disabled',
    ],
    [
      'the authority is unavailable',
      (server: FakeServer) =>
        server.failNext(SERVER_PATH.TOKEN, serverRefusal(503, SERVER_CODE.AUTHORITY_UNAVAILABLE)),
      'apiFailure',
    ],
    [
      'the limiter answers 429',
      (server: FakeServer) =>
        server.failNext(SERVER_PATH.TOKEN, serverRefusal(429, SERVER_CODE.RATE_LIMIT_EXCEEDED)),
      'throttled',
    ],
    [
      'the answer is lost',
      (server: FakeServer) => server.loseNextAnswer(SERVER_PATH.TOKEN),
      'transportFailure',
    ],
  ] as const)('ends signed out with nothing stored when %s', async (_name, fail, kind) => {
    const { app, server, store } = device();
    await app.engine.restore();
    fail(server);

    const outcome = await app.engine.signIn();

    expect(outcome.kind).toBe(kind);
    expect(app.engine.snapshot.status).toBe('signedOut');
    expect(store.items.has(RECORD_KEY)).toBe(false);
    expect(paths(server)).toEqual([SERVER_PATH.TOKEN]);
  });

  it('reports the exchange as under way while the server has not answered, then signs in', async () => {
    const { app, server } = device();
    await app.engine.restore();
    const release = server.holdNext(SERVER_PATH.TOKEN);
    const sent = new Promise<void>((resolve) => {
      const stop = app.engine.subscribe(({ operation }) => {
        if (operation !== 'exchanging') return;
        stop();
        resolve();
      });
    });

    const signIn = app.engine.signIn();
    await sent;
    await queuedWorkDone();
    const during = { ...app.engine.snapshot };
    release();

    expect(during).toEqual({ status: 'signedOut', operation: 'exchanging' });
    expect((await signIn).kind).toBe('signedIn');
    expect(app.engine.snapshot.profile?.email).toBe(SERVER_USER.email);
  });
});

describe('a signed-in app against a server that refuses or cannot be reached', () => {
  it('renews the access token 270 seconds in, and not a second sooner', async () => {
    const { app, server, time } = await signedIn();

    time.advance(RENEW_AFTER_MS - 1);
    await app.client.profile.get();
    expect(server.refreshes).toBe(0);

    time.advance(1);
    await app.client.profile.get();
    expect(server.refreshes).toBe(1);
  });

  it('renews once and repeats the request when the server says the session is invalid', async () => {
    const { app, server } = await signedIn();
    server.failNext(SERVER_PATH.PROFILE, serverRefusal(401, SERVER_CODE.SESSION_INVALID));

    const profile = await app.client.profile.get();

    expect(profile).toEqual(SERVER_USER);
    expect(paths(server).slice(2)).toEqual([
      SERVER_PATH.PROFILE,
      SERVER_PATH.TOKEN,
      SERVER_PATH.PROFILE,
    ]);
  });

  it('stops using the session when the kill switch answers, and sends nothing after it', async () => {
    const { app, server, store } = await signedIn();
    server.failNext(SERVER_PATH.PROFILE, serverRefusal(403, SERVER_CODE.NATIVE_AUTH_DISABLED));

    await expect(app.client.profile.get()).rejects.toMatchObject({
      status: 403,
      code: 'NATIVE_AUTH_DISABLED',
    });
    await expect(app.client.profile.get()).rejects.toMatchObject({ name: 'AuthSessionError' });

    expect(app.engine.snapshot).toEqual({
      status: 'signedOut',
      operation: 'none',
      reason: 'disabled',
    });
    expect(store.items.has(RECORD_KEY)).toBe(false);
    expect(paths(server).slice(2)).toEqual([SERVER_PATH.PROFILE]);
    expect(server.revoked).toEqual([]);
  });

  it('keeps the session when a request is refused for a missing permission', async () => {
    const { app, server, store } = await signedIn();
    server.failNext(SERVER_PATH.PROFILE, serverRefusal(403, 'FORBIDDEN'));

    await expect(app.client.profile.get()).rejects.toMatchObject({ status: 403 });

    expect(app.engine.snapshot.status).toBe('signedIn');
    expect(store.items.has(RECORD_KEY)).toBe(true);
    expect(server.refreshes).toBe(0);
  });

  it.each([
    ['the authority is unavailable', serverRefusal(503, SERVER_CODE.AUTHORITY_UNAVAILABLE)],
    ['the limiter answers 429', serverRefusal(429, SERVER_CODE.RATE_LIMIT_EXCEEDED)],
  ] as const)('stays signed in when %s during a renewal', async (_name, refusal) => {
    const { app, server } = await signedIn();
    server.failNext(SERVER_PATH.TOKEN, refusal);

    const outcome = await app.engine.refresh();

    expect(outcome).toMatchObject({ kind: 'failed', error: { status: refusal.status } });
    expect(app.engine.snapshot).toMatchObject({ status: 'signedIn', operation: 'none' });
    expect(server.refreshes).toBe(1);
  });

  it('asks for sign-in when the answer to a renewal is lost, since the token may be spent', async () => {
    const { app, server } = await signedIn();
    server.loseNextAnswer(SERVER_PATH.TOKEN);

    const outcome = await app.engine.refresh();

    expect(outcome.kind).toBe('failed');
    expect(app.engine.snapshot).toMatchObject({
      status: 'reauthRequired',
      reason: 'refreshInterrupted',
    });
    expect(server.refreshes).toBe(1);
  });

  it.each([
    [
      'the authority is unavailable',
      (server: FakeServer) =>
        server.failNext(SERVER_PATH.REVOKE, serverRefusal(503, SERVER_CODE.AUTHORITY_UNAVAILABLE)),
      [],
    ],
    [
      'the answer is lost',
      (server: FakeServer) => server.loseNextAnswer(SERVER_PATH.REVOKE),
      ['refresh-1'],
    ],
  ] as const)(
    'signs out on the device and reports the revoke as failed when %s',
    async (_name, fail, revoked) => {
      const { app, server, store, installMarker, time } = await signedIn();
      fail(server);

      const outcome = await app.engine.signOut();

      expect(outcome).toMatchObject({ kind: 'signedOut', revocation: 'failed' });
      expect(app.engine.snapshot.status).toBe('signedOut');
      expect(server.revoked).toEqual(revoked);
      // The token the server did not confirm waits to be revoked again; it is no session.
      expect(storedValue(store)).toEqual({
        session: false,
        waiting: [{ refreshToken: SESSION_REFRESH_TOKEN, attempts: 1 }],
      });
      const stored = store.items.get(RECORD_KEY);

      const restarted = device({ store, installMarker, time });
      await expect(restarted.app.engine.restore()).resolves.toEqual({
        kind: 'restored',
        status: 'signedOut',
      });
      await expect(restarted.app.engine.refresh()).resolves.toEqual({ kind: 'notSignedIn' });
      expect(restarted.server.requests).toEqual([]);
      expect(store.items.get(RECORD_KEY)).toBe(stored);
    },
  );
});
