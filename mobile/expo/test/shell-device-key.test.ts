import { cannedKeySource, FakeDeviceKeyNative, type FakeHardware } from '@app/device-key/testing';
import type { KeyProtection } from '@app/device-key';
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
} from '@app/native-adapters/testing';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/logic/resolve-config';
import { startShellAuth, type StartedShellAuth } from '../src/shell';

/** Node has it. The shell's own types leave every Node global out. */
declare function atob(data: string): string;

/** Written by hand: prefix, protection part, escaped client id, environment. */
const HARDWARE_ALIAS = 'devicekey.hw.com_002eexample_002emobile.development';
const SOFTWARE_ALIAS = 'devicekey.sw.com_002eexample_002emobile.development';
/** The first canned key, as the base64url coordinates of its point. */
const PROOF_HEADER = {
  typ: 'dpop+jwt',
  alg: 'ES256',
  jwk: {
    kty: 'EC',
    crv: 'P-256',
    x: 'kEkTQfzZyf-oZboWzbjN20L1Dq7hNYukIyvH3msY394',
    y: 'Dhwd2dUIhY_-YTgJDQNh7VMP7CMF7LhiwZAwaFo17BM',
    alg: 'ES256',
  },
};
const TOKEN_ROUTE = 'http://localhost:5001/api/oauth/token';

interface SentRequest {
  address: string;
  headers: Record<string, string>;
}

function device(hardware: FakeHardware, challenge = false, challengeRefresh = false) {
  const server = new FakeServer();
  const native = new FakeDeviceKeyNative({ hardware, keys: cannedKeySource() });
  const browser = new FakeWebBrowser();
  browser.respond = (url) => ({ type: 'success', url: server.authorize(url) });
  const sent: SentRequest[] = [];
  let challenged = false;

  const start = (keyProtection: KeyProtection): Promise<StartedShellAuth> =>
    startShellAuth(
      {
        deviceKey: native,
        secureStore: new FakeSecureStore(),
        keychainOptions: { keychainAccessible: 4 },
        webBrowser: browser,
        crypto: new FakeCrypto(),
        sha256Algorithm: FAKE_SHA256,
        linking: new FakeLinking(null),
        installMarker: new FakeMarkerFile(),
        recordMarker: new FakeMarkerFile(),
        uuid: new FakeUuid(),
        clock: new FakeTime(),
        timers: new FakeTime(),
        http: {
          createAbort: () => server.createAbort(),
          fetch(address, init) {
            sent.push({ address, headers: init.headers });
            if (
              (challenge || (challengeRefresh && init.body?.includes('refresh_token'))) &&
              !challenged &&
              address === TOKEN_ROUTE
            ) {
              challenged = true;
              return Promise.resolve({
                status: 400,
                headers: {
                  get: (name: string) => (name.toLowerCase() === 'dpop-nonce' ? 'nonce-1' : null),
                },
                text: async () => '{"error":"use_dpop_nonce"}',
              });
            }
            return server.fetch(address, init);
          },
        },
      },
      {
        configuration: resolveConfig({
          apiOrigin: undefined,
          development: true,
          scheme: 'com.example.mobile',
        }),
        ephemeralBrowserSession: true,
        keyProtection,
      },
    );
  return { native, sent, start };
}

/** The header of the proof each token request carried, or `undefined` for a request with none. */
function proofHeaders(sent: readonly SentRequest[]): unknown[] {
  return sent
    .filter(({ address }) => address === TOKEN_ROUTE)
    .map(({ headers }) => {
      const part = headers.DPoP?.split('.')[0];
      if (part === undefined) return undefined;
      return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    });
}

async function signIn(app: StartedShellAuth): Promise<string> {
  await app.engine.restore();
  return (await app.engine.signIn()).kind;
}

describe('the shell handing the device key to the engine', () => {
  it('prepares the key once at start, before anything is sent', async () => {
    const { native, sent, start } = device('secureEnclave');

    const app = await start('hardwareOnly');

    expect(app.deviceKey).toEqual({ kind: 'ready', protection: 'secureEnclave' });
    expect([...native.keys.keys()]).toEqual([HARDWARE_ALIAS]);
    expect(native.count('getKeyAsync')).toBe(1);
    expect(native.count('generateKeyAsync')).toBe(1);
    expect(sent).toEqual([]);
  });

  it('signs the code exchange with the key when the key is ready', async () => {
    const { native, sent, start } = device('secureEnclave');
    const app = await start('hardwareOnly');

    expect(await signIn(app)).toBe('signedIn');

    expect(proofHeaders(sent)).toEqual([PROOF_HEADER]);
    expect(native.count('signAsync')).toBe(1);
    expect(native.count('generateKeyAsync')).toBe(1);
  });

  it('leaves the key out on a device with no secure hardware, and signs in unbound', async () => {
    const { native, sent, start } = device('none');

    const app = await start('hardwareOnly');

    expect(app.deviceKey).toEqual({ kind: 'noSecureHardware' });
    expect(await signIn(app)).toBe('signedIn');
    expect(proofHeaders(sent)).toEqual([undefined]);
    expect(sent.every(({ headers }) => !('DPoP' in headers))).toBe(true);
    expect(native.keys.size).toBe(0);
    expect(native.count('signAsync')).toBe(0);
  });

  it('makes a software key under its own alias when the build allows one', async () => {
    const { native, sent, start } = device('none');

    const app = await start('softwareAllowed');

    expect(app.deviceKey).toEqual({ kind: 'ready', protection: 'software' });
    expect([...native.keys.keys()]).toEqual([SOFTWARE_ALIAS]);
    expect(await signIn(app)).toBe('signedIn');
    expect(proofHeaders(sent)).toEqual([PROOF_HEADER]);
  });

  it('keeps the key when it was only out of reach at start', async () => {
    const { native, sent, start } = device('secureEnclave');
    native.failNext('getKeyAsync');

    const app = await start('hardwareOnly');

    expect(app.deviceKey).toEqual({ kind: 'unavailable' });
    expect(await signIn(app)).toBe('signedIn');
    expect(proofHeaders(sent)).toEqual([PROOF_HEADER]);
  });

  it('counts both token requests when a device-bound refresh is challenged', async () => {
    const { start } = device('secureEnclave', false, true);
    const app = await start('hardwareOnly');
    expect(await signIn(app)).toBe('signedIn');
    expect(app.debug.refreshTokenRequests()).toBe(0);

    expect((await app.engine.refresh()).kind).toBe('refreshed');

    expect(app.debug.refreshTokenRequests()).toBe(2);
    app.engine.dispose();
  });

  it('hands a nonce challenge through the transport to the engine retry', async () => {
    const { sent, start } = device('secureEnclave', true);
    const app = await start('hardwareOnly');

    expect(await signIn(app)).toBe('signedIn');
    const nonces = sent
      .filter(({ address }) => address === TOKEN_ROUTE)
      .map(({ headers }) => {
        const part = headers.DPoP?.split('.')[1] ?? '';
        const payload: unknown = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
        return typeof payload === 'object' && payload !== null && 'nonce' in payload
          ? payload.nonce
          : undefined;
      });
    expect(nonces).toEqual(['', 'nonce-1']);
  });
});
