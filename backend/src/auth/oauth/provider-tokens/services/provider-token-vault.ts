import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../../../common/services/clock';
import {
  REVOCATION_FAILURE,
  REVOCATION_UNCLAIMED_AFTER_MS,
} from '../constants/provider-tokens.constants';
import type {
  RevocableProvider,
  RevocationAttempt,
} from '../revocable-provider';
import { ProviderTokenStore } from '../stores/provider-token.store';
import type { TokenOwner } from '../types/provider-tokens';
import { ProviderTokenCrypto } from './provider-token-crypto';

function errorKind(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Keeps the refresh token a provider hands out at sign-in or at linking, so
 * erasure and unlinking can revoke it later. Keeping it never fails the
 * sign-in it came with. A token the store refuses is revoked at once, since
 * nothing could revoke it later.
 */
@Injectable()
export class ProviderTokenVault {
  private readonly logger = new Logger(ProviderTokenVault.name);
  private warnedNoKey = false;

  constructor(
    private readonly store: ProviderTokenStore,
    private readonly crypto: ProviderTokenCrypto,
    private readonly clock: Clock,
  ) {}

  /** `issuer` is the strategy that obtained the token, which can revoke it. */
  async keep(
    owner: TokenOwner,
    refreshToken: string | undefined,
    issuer: RevocableProvider,
  ): Promise<void> {
    if (!refreshToken) return;
    if (!this.crypto.canSeal()) {
      this.warnNoKeyOnce(owner.provider);
      return;
    }
    const now = this.clock.now();
    try {
      await this.store.keep({
        ...owner,
        sealed: this.crypto.seal(refreshToken, owner),
        storedAt: now,
        checkAfter: new Date(now.getTime() + REVOCATION_UNCLAIMED_AFTER_MS),
      });
    } catch (error) {
      this.logger.error(
        `A ${owner.provider} refresh token was not kept: ${errorKind(error)}`,
      );
      await this.revokeUnkept(owner, refreshToken, issuer);
    }
  }

  private async revokeUnkept(
    owner: TokenOwner,
    token: string,
    issuer: RevocableProvider,
  ): Promise<void> {
    const attempt = await issuer
      .revokeProviderToken({ token, clientId: owner.clientId })
      .catch((): RevocationAttempt => ({
        kind: 'failed',
        code: REVOCATION_FAILURE.REQUEST_FAILED,
      }));
    if (attempt.kind === 'revoked') return;
    this.logger.error(
      `A ${owner.provider} refresh token that was not kept could not be revoked either`,
    );
  }

  private warnNoKeyOnce(provider: string): void {
    if (this.warnedNoKey) return;
    this.warnedNoKey = true;
    this.logger.warn(
      `PROVIDER_TOKEN_ENCRYPTION_KEY is not set, so ${provider} refresh tokens are not kept and cannot be revoked`,
    );
  }
}
