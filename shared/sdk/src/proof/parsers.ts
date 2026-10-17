import { HTTP_STATUS_OK } from '../constants';
import { malformedResponse } from '../envelope';
import { rawSuccessObject } from '../raw';
import type { TransportResponse } from '../transport';
import type { FreshProof, ProofCodeResult } from '../types/proof';
import { isoDate } from '../native-auth/validation';
// feature:passkeys:start
import { BROWSER_AUTHENTICATOR_TRANSPORTS } from './constants';
import { parsePasskeyOptions } from '../native-auth/passkey-parser';
import {
  type BrowserAuthenticatorTransport,
  type BrowserPasskeyProofOptions,
} from '../types/proof';
// feature:passkeys:end

export function unwrapProofCodeResult(response: TransportResponse): ProofCodeResult {
  const value = rawSuccessObject(response)['expiresInMinutes'];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw malformedResponse(response.status, 'Proof code lifetime is invalid');
  }
  return { expiresInMinutes: value };
}

export function unwrapProofCodeResultBody(body: unknown): ProofCodeResult {
  return unwrapProofCodeResult({ status: HTTP_STATUS_OK, body });
}

export function unwrapFreshProof(response: TransportResponse): FreshProof {
  return { provedAt: isoDate(rawSuccessObject(response)['provedAt'], 'provedAt', response.status) };
}

export function unwrapFreshProofBody(body: unknown): FreshProof {
  return unwrapFreshProof({ status: HTTP_STATUS_OK, body });
}

// feature:passkeys:start
function transport(value: string, status: number): BrowserAuthenticatorTransport {
  const known = BROWSER_AUTHENTICATOR_TRANSPORTS.find((entry) => entry === value);
  if (known === undefined) throw malformedResponse(status, 'Passkey transport is unsupported');
  return known;
}

export function unwrapBrowserPasskeyProofOptions(
  response: TransportResponse,
): BrowserPasskeyProofOptions {
  const options = parsePasskeyOptions(rawSuccessObject(response), response.status);
  if (options.rpId === undefined || options.userVerification !== 'required') {
    throw malformedResponse(
      response.status,
      'Browser passkey proof requires its RP and user verification',
    );
  }
  const { allowCredentials, ...base } = options;
  return {
    ...base,
    rpId: options.rpId,
    userVerification: options.userVerification,
    ...(allowCredentials === undefined
      ? {}
      : {
          allowCredentials: allowCredentials.map(({ transports, ...credential }) => ({
            ...credential,
            ...(transports === undefined
              ? {}
              : { transports: transports.map((value) => transport(value, response.status)) }),
          })),
        }),
  };
}

export function unwrapBrowserPasskeyProofOptionsBody(body: unknown): BrowserPasskeyProofOptions {
  return unwrapBrowserPasskeyProofOptions({ status: HTTP_STATUS_OK, body });
}
// feature:passkeys:end
