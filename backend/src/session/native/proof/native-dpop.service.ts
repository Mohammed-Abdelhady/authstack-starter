import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { UniqueConflictError } from '../../../common/persistence/persistence-errors';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  NATIVE_DPOP_FAILURE_REASON,
  NATIVE_DPOP_PROOF_ID_TTL_MS,
  NATIVE_DPOP_SECRET_MIN_LENGTH,
  NATIVE_DPOP_REVOKE_PATH,
  NATIVE_DPOP_TOKEN_PATH,
} from '../../constants/session-policy';
import {
  NATIVE_CONSTRAINT,
  NativeCredentialStore,
} from '../credentials/native-credential.store';
import { hashToken } from '../../utils/hashing/token-hash';
import {
  NativeDpopProofResult,
  verifyNativeDpopProof,
} from './native-dpop-proof';
import {
  nativeDpopNonceCandidates,
  createNativeDpopNonce,
} from './native-dpop-nonce';

export interface NativeDpopExchangeVerification {
  result: NativeDpopProofResult;
  challengeNonce?: string;
}

export type NativeDpopVerification = NativeDpopExchangeVerification;

@Injectable()
export class NativeDpopService {
  constructor(
    private readonly credentials: NativeCredentialStore,
    private readonly config: ConfigService,
  ) {}

  verifyExchangeProof(
    proof: string,
    now: Date,
  ): NativeDpopExchangeVerification {
    return this.verifyRequestProof(proof, NATIVE_DPOP_TOKEN_PATH, now);
  }

  verifyBoundTokenProof(
    proof: string | undefined,
    token: string,
    expectedThumbprint: string,
    endpointPath:
      typeof NATIVE_DPOP_TOKEN_PATH | typeof NATIVE_DPOP_REVOKE_PATH,
    now: Date,
  ): NativeDpopVerification {
    const configuration = this.readProofConfiguration(endpointPath);
    if (typeof proof !== 'string') {
      return {
        result: {
          ok: false,
          reason: NATIVE_DPOP_FAILURE_REASON.PROOF_REQUIRED,
        },
      };
    }
    const result = verifyNativeDpopProof({
      proof,
      expectedMethod: 'POST',
      expectedAddress: configuration.expectedAddress,
      now,
      expectedNonces: nativeDpopNonceCandidates(configuration.secret, now),
      token,
    });
    if (result.ok && result.thumbprint !== expectedThumbprint) {
      return {
        result: { ok: false, reason: NATIVE_DPOP_FAILURE_REASON.KEY_MISMATCH },
      };
    }
    return this.withNonceChallenge(result, configuration.secret, now);
  }

  private verifyRequestProof(
    proof: string,
    endpointPath:
      typeof NATIVE_DPOP_TOKEN_PATH | typeof NATIVE_DPOP_REVOKE_PATH,
    now: Date,
  ): NativeDpopVerification {
    const configuration = this.readProofConfiguration(endpointPath);
    const result = verifyNativeDpopProof({
      proof,
      expectedMethod: 'POST',
      expectedAddress: configuration.expectedAddress,
      now,
      expectedNonces: nativeDpopNonceCandidates(configuration.secret, now),
    });
    return this.withNonceChallenge(result, configuration.secret, now);
  }

  private readProofConfiguration(
    endpointPath:
      typeof NATIVE_DPOP_TOKEN_PATH | typeof NATIVE_DPOP_REVOKE_PATH,
  ): { secret: string; expectedAddress: string } {
    const secret = requireNativeDpopNonceSecret(
      this.config.get<unknown>('auth.nativeDpopNonceSecret'),
    );
    const apiOrigin = this.config.get<string>('server.apiUrl');
    if (!apiOrigin) {
      throw new AppException(
        ErrorCode.NATIVE_DPOP_CONFIGURATION_INVALID,
        'Native DPoP configuration is invalid',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    const expectedAddress = resolveNativeDpopAddress(apiOrigin, endpointPath);
    if (!expectedAddress) {
      throw new AppException(
        ErrorCode.NATIVE_DPOP_CONFIGURATION_INVALID,
        'Native DPoP configuration is invalid',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return { secret, expectedAddress };
  }

  private withNonceChallenge(
    result: NativeDpopProofResult,
    secret: string,
    now: Date,
  ): NativeDpopVerification {
    const challengeNonce =
      !result.ok &&
      (result.reason === NATIVE_DPOP_FAILURE_REASON.NONCE_REQUIRED ||
        result.reason === NATIVE_DPOP_FAILURE_REASON.NONCE_INVALID)
        ? createNativeDpopNonce(secret, now)
        : undefined;
    return { result, challengeNonce };
  }

  async reserveProofId(
    unitOfWork: UnitOfWork,
    jti: string,
    now: Date,
  ): Promise<void> {
    await this.credentials.reserveProofId(
      unitOfWork,
      hashToken(jti),
      new Date(now.getTime() + NATIVE_DPOP_PROOF_ID_TTL_MS),
    );
  }
}

export function requireNativeDpopNonceSecret(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < NATIVE_DPOP_SECRET_MIN_LENGTH
  ) {
    throw new AppException(
      ErrorCode.NATIVE_DPOP_CONFIGURATION_INVALID,
      'Native DPoP configuration is invalid',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
  return value;
}

export function resolveNativeDpopTokenAddress(
  apiOrigin: string,
): string | undefined {
  return resolveNativeDpopAddress(apiOrigin, NATIVE_DPOP_TOKEN_PATH);
}

export function resolveNativeDpopAddress(
  apiOrigin: string,
  endpointPath: typeof NATIVE_DPOP_TOKEN_PATH | typeof NATIVE_DPOP_REVOKE_PATH,
): string | undefined {
  try {
    const apiUrl = new URL(apiOrigin);
    if (
      !['http:', 'https:'].includes(apiUrl.protocol) ||
      !apiUrl.hostname ||
      apiUrl.username ||
      apiUrl.password
    ) {
      return undefined;
    }
    const pathPrefix = apiUrl.pathname.replace(/\/+$/, '');
    apiUrl.pathname = `${pathPrefix}${endpointPath}`;
    apiUrl.search = '';
    apiUrl.hash = '';
    return apiUrl.toString();
  } catch {
    return undefined;
  }
}

/** True for a unit of work that ended because its proof id was already stored. */
export function isNativeProofIdReplay(error: unknown): boolean {
  return (
    error instanceof UniqueConflictError &&
    error.constraint === NATIVE_CONSTRAINT.PROOF_ID
  );
}
