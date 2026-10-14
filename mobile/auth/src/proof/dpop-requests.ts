import { DPOP_PROOF_HEADER, OAUTH_ERROR } from '@app/sdk';
import { OAuthError } from '@app/sdk';
import { DPOP_CHALLENGES_ANSWERED_MAX } from '../constants';
import { buildDpopProof } from './dpop-proof';
import type { DpopProofDependencies } from './dpop-proof';
import type { AbortSignalPort } from '../types/auth';

export interface DpopRequestInput extends DpopProofDependencies {
  serverBaseAddress: string;
  method: string;
  path: string;
  token?: string;
  expectedThumbprint?: string | undefined;
  nonce?: string | undefined;
  signal?: AbortSignalPort;
  mayRetryChallenge?: () => boolean;
  onNonce?: (nonce: string) => void;
  /** Shared by the calls of one operation, so they answer the limit between them. */
  challenges?: ChallengeCount;
}

export interface ChallengeCount {
  answered: number;
}

export interface DpopCallOptions {
  headers: Readonly<Record<string, string>>;
  signal?: AbortSignalPort;
}

export async function requestWithDpopNonceRetry<T>(
  input: DpopRequestInput,
  send: (options: DpopCallOptions) => Promise<T>,
): Promise<{ value: T; thumbprint: string }> {
  let nonce = input.nonce;
  const challenges = input.challenges ?? { answered: 0 };
  for (let attempt = 0; attempt <= DPOP_CHALLENGES_ANSWERED_MAX; attempt += 1) {
    const proof = await buildDpopProof({
      crypto: input.crypto,
      clock: input.clock,
      timer: input.timer,
      ...(input.deviceKey === undefined ? {} : { deviceKey: input.deviceKey }),
      serverBaseAddress: input.serverBaseAddress,
      method: input.method,
      path: input.path,
      ...(input.token === undefined ? {} : { token: input.token }),
      ...(nonce === undefined ? {} : { nonce }),
      ...(input.expectedThumbprint === undefined
        ? {}
        : { expectedThumbprint: input.expectedThumbprint }),
    });
    try {
      const value = await send({
        headers: { [DPOP_PROOF_HEADER]: proof.proof },
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      return { value, thumbprint: proof.thumbprint };
    } catch (error) {
      if (!isNonceChallenge(error) || input.signal?.aborted) throw error;
      if (challenges.answered >= DPOP_CHALLENGES_ANSWERED_MAX) throw error;
      if (input.mayRetryChallenge && !input.mayRetryChallenge()) throw error;
      challenges.answered += 1;
      nonce = error.dpopNonce;
      input.onNonce?.(nonce);
    }
  }
  throw new Error('The DPoP nonce retry did not produce a result');
}

export function isNonceChallenge(
  error: unknown,
): error is OAuthError & { readonly dpopNonce: string } {
  return (
    error instanceof OAuthError &&
    error.error === OAUTH_ERROR.USE_DPOP_NONCE &&
    typeof error.dpopNonce === 'string' &&
    error.dpopNonce.length > 0
  );
}
