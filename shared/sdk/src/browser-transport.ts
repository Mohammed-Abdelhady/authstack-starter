import { unwrapIdentity } from './identity';
import { isJsonObject } from './envelope';
import type { TransportResponse, TransportSignal } from './transport';
import {
  CSRF_FAILURE_CODES,
  IDENTITY_ENDPOINT,
  LOGOUT_ENDPOINT,
  methodNeedsBrowserProof,
} from './browser-transport/constants';
import {
  BrowserParseError,
  StaleResponseError,
  UnknownOutcomeError,
} from './browser-transport/errors';
import { SUCCESS_STATUS_MAX, SUCCESS_STATUS_MIN } from './constants';
import {
  assertNotAborted,
  dispatchBrowserRequest,
  prepareBrowserRequest,
} from './browser-transport/io';
import { createProofState } from './browser-transport/proof-state';
import { loadBrowserProof, rememberIssuedProof } from './browser-transport/proofs';
import type {
  BrowserProofControls,
  BrowserRequest,
  BrowserResponse,
  BrowserTransport,
  BrowserTransportOptions,
  IdentityFence,
} from './browser-transport/types';

export * from './browser-transport/types';
export * from './browser-transport/errors';
export { createOperationHandle } from './browser-transport/operations';
export {
  BROWSER_PROOF_ENDPOINT,
  CSRF_ENDPOINT,
  CSRF_HEADER,
  methodNeedsBrowserProof,
} from './browser-transport/constants';
export { requireHttpSuccess } from './browser-transport/io';

function isProofFailure(response: TransportResponse): boolean {
  const body = response.body;
  if (!isJsonObject(body) || !isJsonObject(body['error'])) return false;
  const code = body['error']['code'];
  return response.status >= 400 && typeof code === 'string' && CSRF_FAILURE_CODES.has(code);
}

function updateIdentityProofHint(state: BrowserProofControls, response: TransportResponse): void {
  try {
    const identity = unwrapIdentity(response);
    if (identity.authenticated) {
      state.rememberSessionPresent();
    } else {
      state.clearBrowserProof();
      state.rememberNoSession();
    }
  } catch {
    state.clearBrowserProof();
  }
}

function captureFence<TSnapshot>(fence: IdentityFence<TSnapshot> | undefined): () => boolean {
  if (!fence) return () => true;
  const snapshot = fence.snapshot();
  return () => fence.isCurrent(snapshot);
}

function requireReadableSuccess(response: BrowserResponse): BrowserResponse {
  const failure = response.parsingError;
  if (!failure || response.status < SUCCESS_STATUS_MIN || response.status > SUCCESS_STATUS_MAX) {
    return response;
  }
  if (failure.unknownOutcome) {
    throw new UnknownOutcomeError(failure.operationKey, {
      status: response.status,
      parsingError: failure,
    });
  }
  throw new BrowserParseError(failure);
}

export function createBrowserTransport<
  TSignal extends TransportSignal = TransportSignal,
  TSnapshot = unknown,
>(options: BrowserTransportOptions<TSignal, TSnapshot>): BrowserTransport<TSignal> {
  const state = createProofState();
  const dispatch = (request: BrowserRequest<TSignal>, proof: string) =>
    dispatchBrowserRequest(options.fetch, options.baseUrl ?? '', request, proof);

  const send = async (request: BrowserRequest<TSignal>): Promise<BrowserResponse> => {
    assertNotAborted(request.signal);
    const prepared = prepareBrowserRequest(request);
    const unsafe = methodNeedsBrowserProof(request.method);
    let proof = unsafe ? state.takeBrowserProof() : '';
    if (unsafe && !proof) proof = await loadBrowserProof(state, dispatch, request.signal);
    let response = await dispatch(prepared, proof);
    if (unsafe && isProofFailure(response)) {
      state.clearBrowserProof();
      proof = await loadBrowserProof(state, dispatch, request.signal);
      response = await dispatch(prepared, proof);
    }
    return response;
  };

  return {
    ...state,
    request: async (request) => {
      const identity = request.path === IDENTITY_ENDPOINT;
      const isCurrent = !identity
        ? () => true
        : request.identityFence
          ? captureFence(request.identityFence)
          : captureFence(options.identityFence);
      let response: BrowserResponse | undefined;
      try {
        response = await send(request);
        if (!isCurrent()) throw new StaleResponseError(response);
        rememberIssuedProof(state, response, request.path);
        if (identity) updateIdentityProofHint(state, response);
        return requireReadableSuccess(response);
      } catch (error) {
        if (!isCurrent()) {
          if (error instanceof StaleResponseError) throw error;
          throw new StaleResponseError(response, { cause: error });
        }
        if (identity) state.clearBrowserProof();
        throw error;
      } finally {
        if (request.path === LOGOUT_ENDPOINT) state.clearBrowserProof();
      }
    },
  };
}
