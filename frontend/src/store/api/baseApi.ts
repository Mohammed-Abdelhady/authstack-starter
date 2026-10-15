import { createApi, type BaseQueryFn, type FetchArgs } from '@reduxjs/toolkit/query/react';
import { API_PATHS, requireHttpSuccess, StaleResponseError, type BrowserRequest } from '@app/sdk';
import { browserTransport } from './browser-transport-instance';
import { createIdentityFence } from './identity-fence';
import { restoreStaleResponse, serializeSdkError } from './sdk-errors';
import type { BrowserQueryError } from './types/sdk-errors';

function requestHeaders(headers: FetchArgs['headers']): Record<string, string> {
  const result: Record<string, string> = {};
  const normalized = new Headers();
  if (Array.isArray(headers)) {
    const tuples: [string, string][] = headers.map(([name, value]) => [name, value]);
    new Headers(tuples).forEach((value, key) => normalized.set(key, value));
  } else if (headers instanceof Headers) {
    headers.forEach((value, key) => normalized.set(key, value));
  } else if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) normalized.set(key, value);
    }
  }
  normalized.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function requestPath(args: FetchArgs): string {
  if (!args.params) return args.url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(args.params)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  if (!query) return args.url;
  return `${args.url}${args.url.includes('?') ? '&' : '?'}${query}`;
}

export const browserBaseQuery: BaseQueryFn<string | FetchArgs, unknown, BrowserQueryError> = async (
  args,
  api,
) => {
  const request: FetchArgs = typeof args === 'string' ? { url: args } : args;
  const transportRequest: BrowserRequest<AbortSignal> = {
    path: requestPath(request),
    method: request.method ?? 'GET',
    body: request.body,
    headers: requestHeaders(request.headers),
    signal: api.signal,
    ...(request.url === API_PATHS.auth.identity
      ? { identityFence: createIdentityFence(api.getState) }
      : {}),
  };
  try {
    const response = requireHttpSuccess(await browserTransport.request(transportRequest));
    return { data: response.body };
  } catch (error) {
    if (error instanceof StaleResponseError) return restoreStaleResponse(error);
    return { error: serializeSdkError(error) };
  }
};

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: browserBaseQuery,
  tagTypes: [
    'User',
    'Auth',
    'AuthMethods',
    'LinkedProviders', // feature:oauth-core
    'ProfileSync', // feature:oauth-core
    'Roles',
    'Permissions',
    'Sessions',
    'Passkeys', // feature:passkeys
  ],
  endpoints: () => ({}),
});
