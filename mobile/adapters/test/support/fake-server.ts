import type { FetchInit, FetchResponseApi, HttpApi } from '../../src/types/modules';

export const SERVER_ORIGIN = 'http://localhost:5001';
export const SERVER_CLIENT_ID = 'com.example.mobile';
export const SERVER_RETURN_ADDRESS = 'com.example.mobile://oauth/callback';
export const AUTHORIZATION_CODE = 'code-1';

export const SERVER_USER = {
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

/** Seconds an access token lives. The server's `NATIVE_ACCESS_LIFETIME_MS` is five minutes. */
export const SERVER_ACCESS_LIFETIME_SECONDS = 300;

/** The codes the server's guard and its kill switch answer with, as it spells them. */
export const SERVER_CODE = {
  SESSION_REQUIRED: 'SESSION_REQUIRED',
  SESSION_INVALID: 'SESSION_INVALID',
  NATIVE_AUTH_DISABLED: 'NATIVE_AUTH_DISABLED',
  AUTHORITY_UNAVAILABLE: 'AUTHORITY_UNAVAILABLE',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
} as const;

export const SERVER_PATH = {
  TOKEN: '/api/oauth/token',
  REVOKE: '/api/oauth/revoke',
  PROFILE: '/api/user/profile',
} as const;

/** A refusal in the envelope every API route uses. */
export const serverRefusal = (status: number, code: string) => ({
  status,
  body: { success: false, error: { code, message: code } },
});

/** A refusal in the form the token and revoke routes use. */
export const oauthRefusal = (error: string, description?: string) => ({
  status: 400,
  body: { error, ...(description === undefined ? {} : { error_description: description }) },
});

interface ServerSignal {
  aborted: boolean;
}

interface Scripted {
  path: string;
  /** Answers in place of the server, which then does none of its own work. */
  refusal?: { status: number; body: unknown };
  /** The server does its work, and the answer never arrives. */
  lost?: true;
  /** The server does its work once this resolves. */
  held?: Promise<void>;
}

const NO_ANSWER = 'Network request failed';

export interface ServerRequest {
  method: string;
  path: string;
  credentials: string;
  body: Record<string, unknown>;
}

function json(status: number, body: unknown): FetchResponseApi {
  return { status, text: async () => JSON.stringify(body), headers: { get: () => null } };
}

function parseBody(text: string | undefined): Record<string, unknown> {
  const value: unknown = text === undefined ? {} : JSON.parse(text);
  return typeof value === 'object' && value !== null ? { ...value } : {};
}

/**
 * The local server as `fetch` sees it: one native token family that rotates on
 * every refresh, a profile behind the current access token, and revocation.
 */
export class FakeServer implements HttpApi<ServerSignal> {
  readonly requests: ServerRequest[] = [];
  readonly revoked: unknown[] = [];
  private readonly scripted: Scripted[] = [];
  private generation = 0;
  private active = false;

  /** The next request to this path is refused with this answer, and changes nothing. */
  failNext(path: string, refusal: { status: number; body: unknown }): void {
    this.scripted.push({ path, refusal });
  }

  /** The next request to this path reaches the server, and its answer is lost on the way back. */
  loseNextAnswer(path: string): void {
    this.scripted.push({ path, lost: true });
  }

  /** The next request to this path waits. Call the returned function to let the server answer. */
  holdNext(path: string): () => void {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.scripted.push({ path, held });
    return release;
  }

  private takeScripted(path: string): Scripted | undefined {
    const index = this.scripted.findIndex((entry) => entry.path === path);
    return index === -1 ? undefined : this.scripted.splice(index, 1)[0];
  }

  get refreshes(): number {
    return this.requests.filter(({ body }) => body.grant_type === 'refresh_token').length;
  }

  /** What the sign-in page does: sends the browser back with a code and the state. */
  authorize(address: string): string {
    const state = /[?&]state=([^&]+)/.exec(address)?.[1] ?? '';
    return `${SERVER_RETURN_ADDRESS}?code=${AUTHORIZATION_CODE}&state=${state}`;
  }

  createAbort(): { signal: ServerSignal; abort(): void } {
    const signal = { aborted: false };
    return { signal, abort: () => void (signal.aborted = true) };
  }

  async fetch(address: string, init: FetchInit<ServerSignal>): Promise<FetchResponseApi> {
    if (!address.startsWith(SERVER_ORIGIN)) throw new TypeError(NO_ANSWER);
    const path = address.slice(SERVER_ORIGIN.length);
    const body = parseBody(init.body);
    this.requests.push({ method: init.method, path, credentials: init.credentials, body });
    const scripted = this.takeScripted(path);
    if (scripted?.refusal) return json(scripted.refusal.status, scripted.refusal.body);
    if (scripted?.held) await scripted.held;
    const answer = this.answer(path, body, init.headers);
    if (scripted?.lost) throw new TypeError(NO_ANSWER);
    return answer;
  }

  private answer(
    path: string,
    body: Record<string, unknown>,
    headers: Record<string, string>,
  ): FetchResponseApi {
    if (path === SERVER_PATH.TOKEN) return this.token(body);
    if (path === SERVER_PATH.REVOKE) {
      this.revoked.push(body.token);
      this.active = false;
      return json(200, {});
    }
    if (path === SERVER_PATH.PROFILE && this.authorized(headers)) {
      return json(200, { success: true, data: SERVER_USER });
    }
    const code =
      headers.Authorization === undefined
        ? SERVER_CODE.SESSION_REQUIRED
        : SERVER_CODE.SESSION_INVALID;
    const refusal = serverRefusal(401, code);
    return json(refusal.status, refusal.body);
  }

  private authorized(headers: Record<string, string>): boolean {
    return this.active && headers.Authorization === `Bearer access-${this.generation}`;
  }

  private token(body: Record<string, unknown>): FetchResponseApi {
    const validCode =
      body.grant_type === 'authorization_code' &&
      body.code === AUTHORIZATION_CODE &&
      body.client_id === SERVER_CLIENT_ID &&
      body.redirect_uri === SERVER_RETURN_ADDRESS &&
      typeof body.code_verifier === 'string';
    const validRefresh =
      body.grant_type === 'refresh_token' &&
      this.active &&
      body.refresh_token === `refresh-${this.generation}`;
    if (!validCode && !validRefresh) return json(400, { error: 'invalid_grant' });
    this.generation += 1;
    this.active = true;
    return json(200, {
      access_token: `access-${this.generation}`,
      refresh_token: `refresh-${this.generation}`,
      expires_in: SERVER_ACCESS_LIFETIME_SECONDS,
      token_type: 'Bearer',
      scope: 'api',
    });
  }
}
