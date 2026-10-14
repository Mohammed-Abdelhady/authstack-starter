import { createAuthEngine, type DeviceKeyPort } from '@app/native-auth';
import { createApiClient } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { createNativePorts } from '../src/native-ports';
import { createTimerPort } from '../src/ports/timer';
import { createFetchTransport } from '../src/transport';
import type { FetchInit, FetchResponseApi, HttpApi } from '../src/types/modules';
import {
  FAKE_SHA256,
  FakeCrypto,
  FakeLinking,
  FakeMarkerFile,
  FakeTime,
  FakeUuid,
  FakeWebBrowser,
} from './support/fake-modules';
import {
  AUTHORIZATION_CODE,
  SERVER_ACCESS_LIFETIME_SECONDS,
  SERVER_CLIENT_ID,
  SERVER_ORIGIN,
  SERVER_RETURN_ADDRESS,
  SERVER_USER,
} from './support/fake-server';
import { FakeSecureStore } from './support/fake-store';

const REFRESH_1_TOKEN = ['refresh', '1'].join('-');
const REFRESH_0_TOKEN = ['refresh', '0'].join('-');

const DEADLINE_MS = 20_000;
const SERVER_NONCE = 'nonce-1';
const CHALLENGE = { error: 'use_dpop_nonce', error_description: 'NATIVE_DPOP_NONCE_INVALID' };
/** `{}` as a header and `{"nonce":"nonce-1"}` as a payload, base64url, with an empty signature. */
const PROOF_WITH_SERVER_NONCE = 'e30.eyJub25jZSI6Im5vbmNlLTEifQ.';

interface Signal {
  aborted: boolean;
}

/** A `fetch` response whose header lookup ignores case, as the platform's does. */
function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  const byName = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const response: FetchResponseApi = {
    status,
    text: async () => JSON.stringify(body),
    headers: { get: (name) => byName.get(name.toLowerCase()) ?? null },
  };
  return response;
}

declare function atob(data: string): string;

/** The `nonce` claim of a proof, or nothing when the request carried no proof. */
function nonceOf(proof: string | undefined): unknown {
  const part = proof?.split('.')[1];
  if (part === undefined) return undefined;
  const payload: unknown = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
  return typeof payload === 'object' && payload !== null && 'nonce' in payload
    ? payload.nonce
    : undefined;
}

/** Challenges every token request whose proof lacks its nonce, then issues a bound pair. */
class ChallengingServer implements HttpApi<Signal> {
  readonly tokenRequests: { code: unknown; proof: string | undefined }[] = [];
  nonceHeaderName = 'dpop-nonce';

  createAbort(): { signal: Signal; abort(): void } {
    const signal = { aborted: false };
    return { signal, abort: () => void (signal.aborted = true) };
  }

  async fetch(address: string, init: FetchInit<Signal>): Promise<FetchResponseApi> {
    const path = address.slice(SERVER_ORIGIN.length);
    if (path === '/api/user/profile') return reply(200, { success: true, data: SERVER_USER });
    const body: unknown = init.body === undefined ? {} : JSON.parse(init.body);
    const code = typeof body === 'object' && body !== null && 'code' in body ? body.code : null;
    const proof = init.headers['DPoP'];
    this.tokenRequests.push({ code, proof });
    // As the server does: a proof without the nonce it handed out is challenged again.
    if (nonceOf(proof) !== SERVER_NONCE) {
      return reply(400, CHALLENGE, { [this.nonceHeaderName]: SERVER_NONCE });
    }
    return reply(200, {
      access_token: 'access-1',
      refresh_token: REFRESH_1_TOKEN,
      expires_in: SERVER_ACCESS_LIFETIME_SECONDS,
      token_type: 'Bearer',
      scope: 'api',
    });
  }
}

const DEVICE_KEY: DeviceKeyPort = {
  publicKey: async () => ({
    kind: 'success',
    value: { kty: 'EC', crv: 'P-256', alg: 'ES256', x: 'x'.repeat(43), y: 'y'.repeat(43) },
  }),
  sign: async () => ({ kind: 'success', value: new Uint8Array(64) }),
};

function transportOver(server: ChallengingServer) {
  return createFetchTransport(server, createTimerPort(new FakeTime()), SERVER_ORIGIN, DEADLINE_MS);
}

describe('fetch transport response headers', () => {
  it.each([['DPoP-Nonce'], ['dpop-nonce']])(
    'hands over a nonce the platform reports as %s under the name the SDK reads',
    async (headerName) => {
      const server = new ChallengingServer();
      server.nonceHeaderName = headerName;

      const response = await transportOver(server).request({
        method: 'POST',
        path: '/api/oauth/token',
        body: { grant_type: 'authorization_code' },
      });

      expect(response).toEqual({
        status: 400,
        body: CHALLENGE,
        headers: { 'DPoP-Nonce': 'nonce-1' },
      });
    },
  );

  it('carries no headers for a response without a nonce', async () => {
    const server = new ChallengingServer();
    const transport = transportOver(server);

    const response = await transport.request({
      method: 'POST',
      path: '/api/oauth/token',
      body: {},
      headers: { DPoP: PROOF_WITH_SERVER_NONCE },
    });

    expect(response.status).toBe(200);
    expect('headers' in response).toBe(false);
  });

  it('lets the SDK read the nonce of a challenge', async () => {
    const client = createApiClient(transportOver(new ChallengingServer()));

    await expect(
      client.oauth.refresh({ refreshToken: REFRESH_0_TOKEN, clientId: SERVER_CLIENT_ID }),
    ).rejects.toMatchObject({ error: 'use_dpop_nonce', dpopNonce: 'nonce-1' });
  });

  it('completes a device-bound sign-in whose first exchange is challenged', async () => {
    const server = new ChallengingServer();
    const browser = new FakeWebBrowser();
    browser.respond = (url) => {
      const state = /[?&]state=([^&]+)/.exec(url)?.[1] ?? '';
      return {
        type: 'success',
        url: `${SERVER_RETURN_ADDRESS}?code=${AUTHORIZATION_CODE}&state=${state}`,
      };
    };
    const time = new FakeTime();
    const ports = createNativePorts(
      {
        secureStore: new FakeSecureStore(),
        keychainOptions: { keychainAccessible: 4 },
        webBrowser: browser,
        crypto: new FakeCrypto(),
        sha256Algorithm: FAKE_SHA256,
        linking: new FakeLinking(null),
        installMarker: new FakeMarkerFile(),
        recordMarker: new FakeMarkerFile(),
        uuid: new FakeUuid(),
        clock: time,
        timers: time,
      },
      { clientId: SERVER_CLIENT_ID, environment: 'test', ephemeralBrowserSession: true },
    );
    const engine = createAuthEngine(
      {
        serverBaseAddress: SERVER_ORIGIN,
        environment: 'test',
        clientId: SERVER_CLIENT_ID,
        redirectUri: SERVER_RETURN_ADDRESS,
        scopes: ['api'],
      },
      {
        ...ports,
        deviceKey: DEVICE_KEY,
        makeTransport: (baseAddress) =>
          createFetchTransport(server, ports.timer, baseAddress, DEADLINE_MS),
      },
    );
    await engine.restore();

    const outcome = await engine.signIn();

    expect(outcome.kind).toBe('signedIn');
    expect(engine.snapshot.status).toBe('signedIn');
    expect(server.tokenRequests.map(({ code }) => code)).toEqual(['code-1', 'code-1']);
    expect(server.tokenRequests.map(({ proof }) => nonceOf(proof))).toEqual(['', 'nonce-1']);
    expect(time.pendingTimers).toBe(0);
    engine.dispose();
  });
});
