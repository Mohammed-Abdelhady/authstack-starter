import { createHash } from 'crypto';
import { createAuthEngine } from '@app/native-auth';
import type {
  AbortSignalPort,
  AuthDependencies,
  AuthEngine,
  ClockPort,
  TimerPort,
} from '@app/native-auth';
import {
  API_PATHS,
  OAUTH_GRANT_TYPE,
  TransportError,
  TRANSPORT_FAILURE,
} from '@app/sdk';
import type {
  HttpMethod,
  Transport,
  TransportRequest,
  TransportResponse,
} from '@app/sdk';
import request from 'supertest';
import { loginAs, type E2eApp, type TestAgent } from '../e2e-app';
import { SEED_USER } from '../../constants/seed-users';
import { NATIVE_CLIENT_ID, NATIVE_REDIRECT } from './native-authorize.fixtures';
import { buildDpopProof } from '../../../../mobile/auth/src/proof/dpop-proof';
import { parseStoredRecord } from '../../../../mobile/auth/src/storage/persistence';
import { SoftwareDeviceKey } from '../../../../mobile/auth/test/support/software-device-key';
import {
  authorizeWithBrowser,
  type BrowserConsentAttempt,
} from './native-auth-engine-consent';

export const ENGINE_SERVER_BASE_ADDRESS = 'http://127.0.0.1:5107';
const CONFIG = {
  serverBaseAddress: ENGINE_SERVER_BASE_ADDRESS,
  environment: 'test',
  clientId: NATIVE_CLIENT_ID,
  redirectUri: NATIVE_REDIRECT,
  scopes: ['api'],
};

export type EnginePorts = AuthDependencies & {
  clock: ClockPort & { elapsed: number; advance(milliseconds: number): void };
  beforeTransportRequest?: (
    request: TransportRequest<AbortSignalPort>,
  ) => void | Promise<void>;
  afterLostRefreshResponse?: (
    request: TransportRequest<AbortSignalPort>,
    response: TransportResponse,
  ) => Promise<void>;
  loseNextRefreshResponse(): void;
};

export interface EngineHarness {
  engine: AuthEngine;
  ports: EnginePorts;
  requests: TransportRequest<AbortSignalPort>[];
  responses: TransportResponse[];
  authorizationAddresses: string[];
  consentAttempts: BrowserConsentAttempt[];
  serverClock: E2eApp['clock'];
}

export interface BoundEngineHarness extends EngineHarness {
  deviceKey: SoftwareDeviceKey;
  makeDpopProof(token: string, nonce: string): Promise<string>;
}

export async function openEngine(
  e2eApp: E2eApp,
  redirectUri = CONFIG.redirectUri,
  authorizationChoice: 'approve' | 'deny' = 'approve',
  deviceKey?: SoftwareDeviceKey,
  browserAgent?: TestAgent,
): Promise<EngineHarness> {
  const browser = browserAgent ?? (await loginAs(e2eApp.httpServer, SEED_USER));
  const requests: TransportRequest<AbortSignalPort>[] = [];
  const responses: TransportResponse[] = [];
  const authorizationAddresses: string[] = [];
  const consentAttempts: BrowserConsentAttempt[] = [];
  const ports = makePorts(
    browser,
    e2eApp,
    requests,
    responses,
    authorizationAddresses,
    consentAttempts,
    authorizationChoice,
    deviceKey,
  );
  const engine = createAuthEngine({ ...CONFIG, redirectUri }, ports);
  await engine.restore();
  return {
    engine,
    ports,
    requests,
    responses,
    authorizationAddresses,
    consentAttempts,
    serverClock: e2eApp.clock,
  };
}

export async function openEngineWithDeviceKey(
  e2eApp: E2eApp,
): Promise<BoundEngineHarness> {
  const deviceKey = new SoftwareDeviceKey();
  const harness = await openEngine(
    e2eApp,
    CONFIG.redirectUri,
    'approve',
    deviceKey,
  );
  return {
    ...harness,
    deviceKey,
    makeDpopProof: async (token, nonce) => {
      const result = await buildDpopProof({
        crypto: harness.ports.crypto,
        clock: harness.ports.clock,
        timer: harness.ports.timer,
        deviceKey,
        serverBaseAddress: ENGINE_SERVER_BASE_ADDRESS,
        method: 'POST',
        path: API_PATHS.oauth.token,
        token,
        nonce,
      });
      return result.proof;
    },
  };
}

export async function readStoredAuthRecord(ports: EnginePorts) {
  const stored = await ports.credentials.read();
  return stored.kind === 'found' ? parseStoredRecord(stored.value) : undefined;
}

export async function signedInEngine(e2eApp: E2eApp): Promise<EngineHarness> {
  const harness = await openEngine(e2eApp);
  const outcome = await harness.engine.signIn();
  if (outcome.kind !== 'signedIn')
    throw new Error(`Sign in failed: ${outcome.kind}`);
  return harness;
}

export function refreshTokenRequests(
  requests: TransportRequest<AbortSignalPort>[],
) {
  return requests.filter(
    ({ path, body }) => path === '/api/oauth/token' && isRefreshBody(body),
  );
}

export function isRefreshBody(
  value: unknown,
): value is { grant_type: string; refresh_token: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'grant_type' in value &&
    value.grant_type === OAUTH_GRANT_TYPE.REFRESH_TOKEN &&
    'refresh_token' in value &&
    typeof value.refresh_token === 'string'
  );
}

function makePorts(
  browser: TestAgent,
  e2eApp: E2eApp,
  requests: TransportRequest<AbortSignalPort>[],
  responses: TransportResponse[],
  authorizationAddresses: string[],
  consentAttempts: BrowserConsentAttempt[],
  authorizationChoice: 'approve' | 'deny',
  deviceKey?: SoftwareDeviceKey,
): EnginePorts {
  let credential: string | undefined;
  let loseRefreshResponse = false;
  const rawTransport = makeE2eTransport(e2eApp);
  const clock: ClockPort & {
    elapsed: number;
    advance(milliseconds: number): void;
  } = {
    elapsed: 1000,
    advance(milliseconds) {
      this.elapsed += milliseconds;
    },
    wallTime: () => e2eApp.clock.now().getTime(),
    monotonicTime() {
      return this.elapsed;
    },
  };
  let randomCall = 0;
  const ports: EnginePorts = {
    ...(deviceKey === undefined ? {} : { deviceKey }),
    credentials: {
      read: () =>
        Promise.resolve(
          credential === undefined
            ? { kind: 'missing' }
            : { kind: 'found', value: credential },
        ),
      replace: (value: string) => {
        credential = value;
        return Promise.resolve({ kind: 'done' });
      },
      delete: () => {
        credential = undefined;
        return Promise.resolve({ kind: 'done' });
      },
    },
    authBrowser: {
      open: async (
        address: string,
        _redirectUri: string,
        _signal: AbortSignalPort,
      ) => {
        authorizationAddresses.push(address);
        return authorizeWithBrowser(
          browser,
          address,
          authorizationChoice,
          consentAttempts,
        );
      },
    },
    crypto: {
      randomBytes: (length: number) => {
        randomCall += 1;
        return Promise.resolve(new Uint8Array(length).fill(randomCall));
      },
      sha256: (bytes: Uint8Array) =>
        Promise.resolve(
          Uint8Array.from(createHash('sha256').update(bytes).digest()),
        ),
    },
    callbacks: {
      subscribe: () => () => undefined,
      initialAddress: () => Promise.resolve({ kind: 'none' }),
    },
    clock,
    timer: new TestTimer(),
    install: {
      identity: () => Promise.resolve({ kind: 'found', id: 'e2e-install' }),
    },
    loseNextRefreshResponse: () => {
      loseRefreshResponse = true;
    },
    makeTransport: (_baseAddress: string) => ({
      request: async (
        transportRequest: TransportRequest<AbortSignalPort>,
      ): Promise<TransportResponse> => {
        await ports.beforeTransportRequest?.(transportRequest);
        requests.push(transportRequest);
        const response = await rawTransport.request(transportRequest);
        responses.push(response);
        if (
          loseRefreshResponse &&
          isRefreshBody(transportRequest.body) &&
          response.status >= 200 &&
          response.status < 300
        ) {
          loseRefreshResponse = false;
          const afterLost = ports.afterLostRefreshResponse;
          ports.afterLostRefreshResponse = undefined;
          await afterLost?.(transportRequest, response);
          throw new TransportError(TRANSPORT_FAILURE.NO_RESPONSE);
        }
        return response;
      },
    }),
  };
  return ports;
}

function makeE2eTransport(e2eApp: E2eApp): Transport<AbortSignalPort> {
  const verbs: Record<HttpMethod, 'get' | 'post' | 'patch' | 'delete'> = {
    GET: 'get',
    POST: 'post',
    PATCH: 'patch',
    DELETE: 'delete',
  };
  return {
    request: async ({ method, path, body, headers }) => {
      let call = request(e2eApp.httpServer)[verbs[method]](path);
      for (const [name, value] of Object.entries(headers ?? {})) {
        if (name.toLowerCase() !== 'content-type') call = call.set(name, value);
      }
      if (typeof body === 'object' && body !== null) call = call.send(body);
      const response = await call;
      const nonce = response.headers['dpop-nonce'];
      return {
        status: response.status,
        body:
          response.type === 'application/json'
            ? (response.body as unknown)
            : undefined,
        ...(typeof nonce === 'string'
          ? { headers: { 'DPoP-Nonce': nonce } }
          : {}),
      };
    },
  };
}

class TestTimer implements TimerPort {
  private nextId = 0;
  private callbacks = new Map<number, () => void>();

  after(_milliseconds: number, callback: () => void): () => void {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    return () => this.callbacks.delete(id);
  }
}
