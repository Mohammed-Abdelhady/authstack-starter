import {
  API_PATHS,
  isSdkError,
  isTransportError,
  TRANSPORT_FAILURE,
  toTransportError,
} from '@app/sdk';
import type { Transport, TransportRequest, TransportResponse } from '@app/sdk';
import type { AbortSignalPort } from '../types/auth';
import type { AuthRuntime } from '../runtime/runtime';
import type { RuntimeTokens } from '../types/record';
import { AuthDisposedError, AuthSessionError, UnsafeRequestPathError } from '../errors/errors';
import { SESSION_STATUS } from '../constants';
import { abortedError, raceWithAbort } from '../runtime/abortable';
import { endSwitchedOffSession, isKillSwitchResponse } from './kill-switch';

export type EnsureCurrentTokens = (signal?: AbortSignalPort) => Promise<RuntimeTokens>;
export type RefreshTokens = (signal?: AbortSignalPort) => Promise<RuntimeTokens>;

export function createBearerTransport(
  runtime: AuthRuntime,
  ensureCurrentTokens: EnsureCurrentTokens,
  refreshTokens: RefreshTokens,
): Transport<AbortSignalPort> {
  const request = (input: TransportRequest<AbortSignalPort>): Promise<TransportResponse> => {
    if (runtime.disposed) return Promise.reject(new AuthDisposedError());
    if (input.signal?.aborted) return Promise.reject(abortedError());
    const pending = performRequest(input);
    if (isOAuthTokenPath(input.path)) return pending;
    return runtime.raceWithDispose(pending, () => {
      throw new AuthDisposedError();
    });
  };

  const performRequest = async (
    input: TransportRequest<AbortSignalPort>,
  ): Promise<TransportResponse> => {
    assertSafeRequestPath(input.path);
    const route = decodeURIComponent(input.path.split('?')[0] ?? '');
    if (isOAuthPath(route)) {
      if (route === API_PATHS.oauth.token) {
        runtime.lastOAuthTokenSentAt = runtime.monotonicTime();
        runtime.oauthTokenRequestSent = true;
      }
      return runtime.rawTransport.request(input);
    }
    const epoch = runtime.epoch;
    const token = await raceWithAbort(ensureCurrentTokens(input.signal), input.signal);
    assertCurrentEpoch(runtime, epoch);
    const first = await sendWithToken(runtime, input, token, epoch);
    assertCurrentEpoch(runtime, epoch);
    if (first.status !== 401) return afterKillSwitch(first);

    const current = runtime.tokens;
    const retryToken =
      current && current.version > token.version
        ? current
        : await raceWithAbort(refreshTokens(input.signal), input.signal);
    assertCurrentEpoch(runtime, epoch);
    const response = await sendWithToken(runtime, input, retryToken, epoch);
    assertCurrentEpoch(runtime, epoch);
    return afterKillSwitch(response);
  };

  /** A sign-in in progress settles its own failed profile read, so only a live session ends here. */
  const afterKillSwitch = async (response: TransportResponse): Promise<TransportResponse> => {
    if (isKillSwitchResponse(response) && runtime.snapshot.status === SESSION_STATUS.SIGNED_IN) {
      await endSwitchedOffSession(runtime);
    }
    return response;
  };
  return { request };
}

async function sendWithToken(
  runtime: AuthRuntime,
  request: TransportRequest<AbortSignalPort>,
  token: RuntimeTokens,
  epoch: number,
): Promise<TransportResponse> {
  if (request.signal?.aborted) throw toTransportError(undefined, request.signal);
  const firstHeaders = withBearer(request.headers, token.accessToken);
  try {
    return await runtime.rawTransport.request({ ...request, headers: firstHeaders });
  } catch (error) {
    if (isSdkError(error) && !isTransportError(error)) throw error;
    const transportError = toTransportError(error, request.signal);
    if (request.method !== 'GET' || transportError.reason !== TRANSPORT_FAILURE.NO_RESPONSE) {
      throw transportError;
    }
    assertCurrentEpoch(runtime, epoch);
    const current = runtime.tokens ?? token;
    try {
      return await runtime.rawTransport.request({
        ...request,
        headers: withBearer(request.headers, current.accessToken),
      });
    } catch (retryError) {
      if (isSdkError(retryError) && !isTransportError(retryError)) throw retryError;
      throw toTransportError(retryError, request.signal);
    }
  }
}

function assertCurrentEpoch(runtime: AuthRuntime, epoch: number): void {
  if (!runtime.isEpochCurrent(epoch)) throw new AuthSessionError();
}

function withBearer(
  headers: Readonly<Record<string, string>> | undefined,
  accessToken: string,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const normalized = name.toLowerCase();
    if (normalized !== 'authorization' && normalized !== 'cookie') result[name] = value;
  }
  result['Authorization'] = `Bearer ${accessToken}`;
  return result;
}

function assertSafeRequestPath(path: string): void {
  const rawRoute = path.split('?')[0] ?? '';
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('#') ||
    /[\\\s]/.test(path) ||
    hasControlCharacter(path)
  ) {
    throw new UnsafeRequestPathError();
  }
  let route: string;
  try {
    route = decodeURIComponent(rawRoute);
  } catch {
    throw new UnsafeRequestPathError();
  }
  const segments = route.split('/');
  if (
    segments.slice(1).some((segment) => segment === '' || segment === '.' || segment === '..') ||
    hasControlCharacter(route)
  ) {
    throw new UnsafeRequestPathError();
  }
  const lowerRoute = route.toLowerCase();
  if (
    (lowerRoute.startsWith(API_PATHS.oauth.token) && lowerRoute !== API_PATHS.oauth.token) ||
    (lowerRoute.startsWith(API_PATHS.oauth.revoke) && lowerRoute !== API_PATHS.oauth.revoke)
  ) {
    throw new UnsafeRequestPathError();
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isOAuthPath(route: string): boolean {
  const normalized = route.toLowerCase();
  return normalized === API_PATHS.oauth.token || normalized === API_PATHS.oauth.revoke;
}

function isOAuthTokenPath(path: string): boolean {
  const route = path.split('?')[0] ?? '';
  try {
    return decodeURIComponent(route).toLowerCase() === API_PATHS.oauth.token;
  } catch {
    return false;
  }
}
