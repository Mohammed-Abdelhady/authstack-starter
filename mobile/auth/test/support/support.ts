import type { Transport, TransportRequest, TransportResponse } from '@app/sdk';
import type {
  AbortSignalPort,
  AuthBrowserResult,
  CredentialReadResult,
  CredentialWriteResult,
  DeviceKeyPort,
  InstallIdentityResult,
  LaunchAddressResult,
} from '../../src';
import { FakeTimer } from './fake-timer';
import { registerTransport } from './tracking';

export const CONFIG = {
  serverBaseAddress: 'https://api.example.test',
  environment: 'test',
  clientId: 'native-client',
  redirectUri: 'sampleapp://auth/callback',
  scopes: ['api'],
} as const;

export const USER = {
  id: 'user-1',
  email: 'person@example.test',
  name: 'Test Person',
  role: 'user',
  permissions: [],
  authProvider: 'password',
  isVerified: true,
  twoFactorEnabled: false, // feature:totp
  passkeyCount: 0, // feature:passkeys
  linkedProviders: [],
};

export const ACCESS_TOKEN = 'access-secret-0';
export const REFRESH_TOKEN = 'refresh-secret-0';
export const REVOKE_TIMEOUT_MS = 5000;

export class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (reason: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

export type CredentialRead = CredentialReadResult;
export type CredentialWrite = CredentialWriteResult;
const DONE: CredentialWrite = { kind: 'done' };

export class MemoryCredentials {
  value: string | undefined;
  readResult: CredentialRead | undefined;
  /** Every write answers this and changes nothing. `beforeReplace` can refuse one the same way. */
  writeResult: CredentialWrite | undefined;
  /** The platform dropped the record on its own, which an adapter reads as corrupt. */
  discarded = false;
  serializedOperations = false;
  beforeReplace: ((value: string) => Promise<CredentialWrite | void>) | undefined;
  afterReplace: ((value: string) => void) | undefined;
  beforeDelete: (() => Promise<void>) | undefined;
  afterDelete: (() => void) | undefined;
  onOperationQueued: ((operation: 'read' | 'replace' | 'delete') => void) | undefined;
  afterRead: ((result: CredentialRead) => void) | undefined;
  readonly events: string[] = [];
  private operationTail: Promise<void> = Promise.resolve();

  read(): Promise<CredentialRead> {
    this.onOperationQueued?.('read');
    return this.enqueue(async () => {
      this.events.push('read');
      const empty: CredentialRead = this.discarded ? { kind: 'corrupt' } : { kind: 'missing' };
      const result =
        this.readResult ??
        (this.value === undefined ? empty : { kind: 'found' as const, value: this.value });
      this.afterRead?.(result);
      return result;
    });
  }

  replace(value: string): Promise<CredentialWrite> {
    this.onOperationQueued?.('replace');
    return this.enqueue(async () => {
      this.events.push('replace:start');
      const refused = this.writeResult ?? (await this.beforeReplace?.(value)) ?? DONE;
      if (refused.kind !== 'done') return refused;
      this.value = value;
      this.discarded = false;
      this.events.push('replace:done');
      this.afterReplace?.(value);
      return DONE;
    });
  }

  delete(): Promise<CredentialWrite> {
    this.onOperationQueued?.('delete');
    return this.enqueue(async () => {
      this.events.push('delete:start');
      await this.beforeDelete?.();
      if (this.writeResult) return this.writeResult;
      this.value = undefined;
      this.discarded = false;
      this.events.push('delete:done');
      this.afterDelete?.();
      return DONE;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.serializedOperations) return operation();
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export type ScriptedRequest = TransportRequest<AbortSignalPort>;
export type TransportStep =
  TransportResponse | Error | ((request: ScriptedRequest) => Promise<TransportResponse>);

export class ScriptedTransport implements Transport<AbortSignalPort> {
  readonly sent: ScriptedRequest[] = [];
  readonly steps: TransportStep[] = [];
  onRequest: ((request: ScriptedRequest) => void) | undefined;
  onResponse: ((request: ScriptedRequest, response: TransportResponse) => void) | undefined;
  respond: ((request: ScriptedRequest) => Promise<TransportResponse>) | undefined;

  constructor() {
    registerTransport(this);
  }

  enqueue(...steps: TransportStep[]): void {
    this.steps.push(...steps);
  }

  async request(request: ScriptedRequest): Promise<TransportResponse> {
    this.sent.push({ ...request, headers: request.headers && { ...request.headers } });
    this.onRequest?.(request);
    if (this.respond) {
      const response = await this.respond(request);
      this.onResponse?.(request, response);
      return response;
    }
    const step = this.steps.shift();
    if (step === undefined)
      throw new Error(`No scripted response for ${request.method} ${request.path}`);
    if (step instanceof Error) throw step;
    const response = typeof step === 'function' ? await step(request) : step;
    this.onResponse?.(request, response);
    return response;
  }
}

export function oauthTokenReply(
  accessToken = ACCESS_TOKEN,
  refreshToken = REFRESH_TOKEN,
  expiresIn = 300,
) {
  return {
    status: 200,
    body: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: 'api',
    },
  };
}

export function apiReply(data: unknown, status = 200) {
  return { status, body: { success: true, data } };
}

export function failedApiReply(status: number, code: string) {
  return { status, body: { success: false, error: { code, message: code } } };
}

export function redirectFrom(address: string, values: Record<string, string>): string {
  const params = new Map(Object.entries(values));
  if (!params.has('state')) params.set('state', readQueryValues(address).get('state') ?? '');
  const query = [...params.entries()]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return `${CONFIG.redirectUri}?${query}`;
}

export function readQueryValues(address: string): Map<string, string> {
  const question = address.indexOf('?');
  const fragment = address.indexOf('#');
  if (question < 0 || (fragment >= 0 && fragment < question)) return new Map();
  const query = address.slice(question + 1, fragment < 0 ? undefined : fragment);
  const values = new Map<string, string>();
  for (const pair of query.split('&')) {
    const separator = pair.indexOf('=');
    const key = decodeURIComponent(separator < 0 ? pair : pair.slice(0, separator));
    const value = decodeURIComponent(separator < 0 ? '' : pair.slice(separator + 1));
    values.set(key, value);
  }
  return values;
}

export function acceptCode(browser: FakeBrowser, code = 'authorization-code'): void {
  browser.results.push((address) => ({
    kind: 'redirect',
    url: redirectFrom(address, { code }),
  }));
}

export class FakeBrowser {
  readonly opened: { address: string; redirectUri: string; signal: AbortSignalPort }[] = [];
  readonly results: ((address: string) => Promise<BrowserResult> | BrowserResult)[] = [];
  beforeOpen: ((address: string) => void) | undefined;

  async open(
    address: string,
    redirectUri: string,
    signal: AbortSignalPort,
  ): Promise<BrowserResult> {
    this.opened.push({ address, redirectUri, signal });
    this.beforeOpen?.(address);
    const next = this.results.shift();
    return next ? next(address) : { kind: 'cancelled' };
  }
}

export type BrowserResult = AuthBrowserResult;

export class FakeCallbacks {
  readonly listeners = new Set<(address: string) => void | Promise<void>>();
  initial: string | undefined;
  initialCalls = 0;
  /** This many reads of the launch address answer `unavailable` first. */
  unavailableReads = 0;
  afterDelivery: (() => void) | undefined;

  subscribe(listener: (address: string) => void | Promise<void>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  initialAddress(): Promise<LaunchAddressResult> {
    this.initialCalls += 1;
    if (this.unavailableReads > 0) {
      this.unavailableReads -= 1;
      return Promise.resolve({ kind: 'unavailable' });
    }
    const address = this.initial;
    this.initial = undefined;
    return Promise.resolve(address === undefined ? { kind: 'none' } : { kind: 'address', address });
  }

  async deliver(address: string): Promise<void> {
    await Promise.all([...this.listeners].map((listener) => listener(address)));
    this.afterDelivery?.();
  }
}

export class FakeClock {
  wall = 1_800_000_000_000;
  elapsed = 1000;

  wallTime(): number {
    return this.wall;
  }

  monotonicTime(): number {
    return this.elapsed;
  }

  advance(milliseconds: number): void {
    this.wall += milliseconds;
    this.elapsed += milliseconds;
  }

  jumpWall(milliseconds: number): void {
    this.wall += milliseconds;
  }
}

export class FakeInstall {
  result: InstallIdentityResult = { kind: 'found', id: 'install-1' };
  calls = 0;

  async identity() {
    this.calls += 1;
    return this.result;
  }
}

export class FakeCrypto {
  private randomFill = 1;
  readonly randomLengths: number[] = [];
  hashOverride: ((bytes: Uint8Array) => Uint8Array) | undefined;

  async randomBytes(length: number): Promise<Uint8Array> {
    this.randomLengths.push(length);
    const bytes = new Uint8Array(length).fill(this.randomFill);
    this.randomFill += 1;
    return bytes;
  }

  async sha256(bytes: Uint8Array): Promise<Uint8Array> {
    if (this.hashOverride) return this.hashOverride(bytes);
    let checksum = 0;
    for (let index = 0; index < bytes.length; index += 1) {
      checksum = (checksum + bytes[index] * (index + 1)) % 251;
    }
    return new Uint8Array(32).fill(checksum);
  }
}

export function testPorts(transport: ScriptedTransport, deviceKey?: DeviceKeyPort) {
  return {
    credentials: new MemoryCredentials(),
    authBrowser: new FakeBrowser(),
    crypto: new FakeCrypto(),
    callbacks: new FakeCallbacks(),
    clock: new FakeClock(),
    timer: new FakeTimer(),
    install: new FakeInstall(),
    makeTransport: (_baseAddress: string) => transport,
    ...(deviceKey === undefined ? {} : { deviceKey }),
  };
}

export function successUserReply() {
  return apiReply(USER);
}

export async function establishSession(
  engine: { restore(): Promise<unknown>; signIn(): Promise<{ kind: string }> },
  ports: ReturnType<typeof testPorts>,
  transport: ScriptedTransport,
  accessToken = ACCESS_TOKEN,
  refreshToken = REFRESH_TOKEN,
): Promise<{ kind: string }> {
  await engine.restore();
  transport.enqueue(oauthTokenReply(accessToken, refreshToken), successUserReply());
  acceptCode(ports.authBrowser);
  return engine.signIn();
}
