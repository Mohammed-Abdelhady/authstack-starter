import type { CallOptions } from '../client';
import { HTTP_METHOD } from '../constants';
import { unwrapFreshProof, unwrapProofCodeResult } from '../proof/parsers';
import type { TransportSignal } from '../transport';
import type { FreshProof, ProofCodeResult } from '../types/proof';
// feature:passkeys:start
import { unwrapBrowserPasskeyProofOptions } from '../proof/parsers';
import type { BrowserPasskeyProofOptions } from '../types/proof';
import type { NativePasskeyAssertion } from '../types/native-auth';
// feature:passkeys:end
import type { AreaSenders } from './shared';

const PROOF_PATH = '/api/auth/proof';
export const BROWSER_PROOF_PATHS = {
  code: `${PROOF_PATH}/code`,
  verifyCode: `${PROOF_PATH}/code/verify`,
  options: `${PROOF_PATH}/options`, // feature:passkeys
  verifyPasskey: `${PROOF_PATH}/verify`, // feature:passkeys
} as const;

export interface ApiClientProof<TSignal extends TransportSignal = TransportSignal> {
  proof: {
    sendCode(options?: CallOptions<TSignal>): Promise<ProofCodeResult>;
    verifyCode(body: { code: string }, options?: CallOptions<TSignal>): Promise<FreshProof>;
    // feature:passkeys:start
    passkeyOptions(options?: CallOptions<TSignal>): Promise<BrowserPasskeyProofOptions>;
    verifyPasskey(
      assertion: NativePasskeyAssertion,
      options?: CallOptions<TSignal>,
    ): Promise<FreshProof>;
    // feature:passkeys:end
  };
}

export function createProofArea<TSignal extends TransportSignal>({
  send,
}: AreaSenders<TSignal>): ApiClientProof<TSignal> {
  return {
    proof: {
      sendCode: async (options) =>
        unwrapProofCodeResult(
          await send({ method: HTTP_METHOD.POST, path: BROWSER_PROOF_PATHS.code }, options),
        ),
      verifyCode: async (body, options) =>
        unwrapFreshProof(
          await send(
            { method: HTTP_METHOD.POST, path: BROWSER_PROOF_PATHS.verifyCode, body },
            options,
          ),
        ),
      // feature:passkeys:start
      passkeyOptions: async (options) =>
        unwrapBrowserPasskeyProofOptions(
          await send({ method: HTTP_METHOD.POST, path: BROWSER_PROOF_PATHS.options }, options),
        ),
      verifyPasskey: async (body, options) =>
        unwrapFreshProof(
          await send(
            { method: HTTP_METHOD.POST, path: BROWSER_PROOF_PATHS.verifyPasskey, body },
            options,
          ),
        ),
      // feature:passkeys:end
    },
  };
}
