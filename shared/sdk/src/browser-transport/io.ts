import { ApiError } from '../errors';
import { unwrapEnvelope } from '../envelope';
import { SUCCESS_STATUS_MAX, SUCCESS_STATUS_MIN, TRANSPORT_FAILURE } from '../constants';
import { toTransportError, TransportError } from '../transport';
import {
  CSRF_HEADER,
  HTTP_STATUS_NO_CONTENT,
  SERVER_ERROR_STATUS_MIN,
  methodNeedsBrowserProof,
} from './constants';
import { BrowserApiError, BrowserParseError, UnknownOutcomeError } from './errors';
import type {
  BrowserFetch,
  BrowserFetchInit,
  BrowserFetchResponse,
  BrowserRequest,
  BrowserResponse,
} from './types';
import type { TransportSignal } from '../transport';

interface PreparedBrowserRequest<TSignal extends TransportSignal> extends BrowserRequest<TSignal> {
  encodedBody?: string;
}

export function prepareBrowserRequest<TSignal extends TransportSignal>(
  request: BrowserRequest<TSignal>,
): PreparedBrowserRequest<TSignal> {
  const encodedBody = request.body === undefined ? undefined : JSON.stringify(request.body);
  return { ...request, ...(encodedBody === undefined ? {} : { encodedBody }) };
}

function joinUrl(baseUrl: string, path: string): string {
  if (!baseUrl || /^([a-z][a-z\d+.-]*:)?\/\//i.test(path)) return path;
  if (!path) return baseUrl;
  const delimiter = baseUrl.endsWith('/') || !path.startsWith('?') ? '/' : '';
  return `${baseUrl.replace(/\/$/, '')}${delimiter}${path.replace(/^\//, '')}`;
}

export function assertNotAborted(signal: TransportSignal | undefined): void {
  if (signal?.aborted) throw new TransportError(TRANSPORT_FAILURE.ABORTED);
}

function fetchInit<TSignal extends TransportSignal>(
  request: PreparedBrowserRequest<TSignal>,
  proof: string,
): BrowserFetchInit<TSignal> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    const normalized = key.toLowerCase();
    if (normalized !== 'content-type' && (normalized !== CSRF_HEADER || !proof)) {
      headers[key] = value;
    }
  }
  headers['Content-Type'] = 'application/json';
  if (!Object.keys(headers).some((name) => name.toLowerCase() === 'accept')) {
    headers['Accept'] = 'application/json';
  }
  if (proof) headers[CSRF_HEADER] = proof;
  const body = request.encodedBody;
  return {
    method: request.method,
    credentials: 'include',
    headers,
    ...(body === undefined ? {} : { body }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  };
}

function failureAfterDispatch<TSignal extends TransportSignal>(
  request: PreparedBrowserRequest<TSignal>,
  cause: unknown,
): Error {
  return methodNeedsBrowserProof(request.method)
    ? new UnknownOutcomeError(request.operationKey, { cause })
    : toTransportError(cause, request.signal);
}

function parseBody<TSignal extends TransportSignal>(
  text: string,
  status: number,
  request: BrowserRequest<TSignal>,
): Pick<BrowserResponse, 'body' | 'parsingError'> {
  if (status === HTTP_STATUS_NO_CONTENT) return { body: undefined };
  try {
    return { body: JSON.parse(text) as unknown };
  } catch (cause) {
    return {
      body: undefined,
      parsingError: {
        originalStatus: status,
        data: text,
        error: String(cause),
        unknownOutcome: methodNeedsBrowserProof(request.method),
        ...(request.operationKey === undefined ? {} : { operationKey: request.operationKey }),
      },
    };
  }
}

export async function dispatchBrowserRequest<TSignal extends TransportSignal>(
  io: BrowserFetch<TSignal>,
  baseUrl: string,
  request: BrowserRequest<TSignal>,
  proof: string,
): Promise<BrowserResponse> {
  const init = fetchInit(request, proof);
  assertNotAborted(request.signal);
  let response: BrowserFetchResponse;
  let text: string;
  try {
    response = await io(joinUrl(baseUrl, request.path), init);
    if (request.signal?.aborted) throw new TransportError(TRANSPORT_FAILURE.ABORTED);
    text = response.status === HTTP_STATUS_NO_CONTENT ? '' : await response.text();
  } catch (error) {
    throw failureAfterDispatch(request, error);
  }
  const headers: Record<string, string> = {};
  for (const name of [CSRF_HEADER, 'dpop-nonce']) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  return {
    status: response.status,
    ...parseBody(text, response.status, request),
    headers,
    unknownOutcome:
      methodNeedsBrowserProof(request.method) && response.status >= SERVER_ERROR_STATUS_MIN,
  };
}

export function requireHttpSuccess(response: BrowserResponse): BrowserResponse {
  if (response.parsingError) throw new BrowserParseError(response.parsingError);
  if (response.status >= SUCCESS_STATUS_MIN && response.status <= SUCCESS_STATUS_MAX)
    return response;
  try {
    return unwrapEnvelope<never>(response);
  } catch (error) {
    if (error instanceof ApiError) {
      throw new BrowserApiError(error, response.body, response.unknownOutcome ?? false);
    }
    throw error;
  }
}
