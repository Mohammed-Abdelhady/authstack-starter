import { ErrorCode } from '@app/core/errors';
import { ApiError, SdkError } from '../errors';
import { isJsonObject } from '../envelope';
import type { TransportResponse, TransportSignal } from '../transport';
import {
  BROWSER_PROOF_ENDPOINT,
  CSRF_ENDPOINT,
  CSRF_HEADER,
  HTTP_STATUS_UNAUTHORIZED,
} from './constants';
import { requireHttpSuccess } from './io';
import type { BrowserProofControls, BrowserRequest } from './types';

type Dispatch<TSignal extends TransportSignal> = (
  request: BrowserRequest<TSignal>,
  proof: string,
) => Promise<TransportResponse>;

export function issuedToken(response: TransportResponse, path: string): string | undefined {
  const header = response.headers?.[CSRF_HEADER];
  if (header) return header;
  if (path !== CSRF_ENDPOINT && path !== BROWSER_PROOF_ENDPOINT) return undefined;
  const body = response.body;
  if (!isJsonObject(body) || !isJsonObject(body['data'])) return undefined;
  const token = body['data']['token'];
  return typeof token === 'string' && token.length > 0 ? token : undefined;
}

export function rememberIssuedProof(
  state: BrowserProofControls,
  response: TransportResponse,
  path: string,
): void {
  state.rememberBrowserProof(
    issuedToken(response, path),
    path === BROWSER_PROOF_ENDPOINT ? 'pre-session' : 'session',
  );
}

function missingProof(): never {
  throw new SdkError('Browser proof was not issued');
}

export async function loadBrowserProof<TSignal extends TransportSignal>(
  state: BrowserProofControls,
  dispatch: Dispatch<TSignal>,
  signal: TSignal | undefined,
): Promise<string> {
  const options = signal === undefined ? {} : { signal };
  if (state.csrfLookupHint() !== 'no-session') {
    const response = await dispatch({ method: 'GET', path: CSRF_ENDPOINT, ...options }, '');
    let sessionMissing = false;
    try {
      requireHttpSuccess(response);
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        (error.status !== HTTP_STATUS_UNAUTHORIZED && error.code !== ErrorCode.CSRF_INVALID)
      ) {
        throw error;
      }
      sessionMissing = true;
      state.rememberNoSession();
    }
    if (!sessionMissing) {
      const token = issuedToken(response, CSRF_ENDPOINT) ?? missingProof();
      state.rememberBrowserProof(token, 'session');
      return token;
    }
  }
  const response = requireHttpSuccess(
    await dispatch({ method: 'GET', path: BROWSER_PROOF_ENDPOINT, ...options }, ''),
  );
  const token = issuedToken(response, BROWSER_PROOF_ENDPOINT) ?? missingProof();
  state.rememberBrowserProof(token, 'pre-session');
  return state.takeBrowserProof();
}
