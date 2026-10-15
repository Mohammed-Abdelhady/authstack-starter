import { HttpStatus, Logger } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { StoredAccount } from '../../user/stores/stored-account';
import {
  OAuthProfile,
  OAuthProviderStrategy,
} from './oauth-provider.interface';
import { LinkingProvider } from './types/oauth-service.types';
import { providerAddressTaken } from './utils/provider-link-error.util';

export function assertEmailVerified(
  strategy: OAuthProviderStrategy,
  profile: OAuthProfile,
): void {
  if (profile.emailVerified || strategy.emailAlwaysVerified) {
    return;
  }

  throw new AppException(
    ErrorCode.OAUTH_EMAIL_UNVERIFIED,
    `The email address on this ${strategy.displayName} account is not verified`,
    HttpStatus.FORBIDDEN,
    { provider: strategy.id },
  );
}

/**
 * Attaching by address alone hands the account to whoever the provider says
 * owns the address. That is refused when the provider states nothing about
 * the address, and when the account's own address was never verified here,
 * because such an account may not belong to the address's owner.
 */
export function assertMayLinkByEmail(
  strategy: LinkingProvider,
  account: StoredAccount,
  logger: Logger,
): void {
  if (strategy.autoLinksByEmail && account.isVerified) {
    return;
  }

  logger.warn(
    `First ${strategy.id} sign-in not attached to an existing account`,
  );
  throw providerAddressTaken(strategy.id);
}

export function assertActive(
  user: StoredAccount,
  provider: string,
  logger: Logger,
): void {
  if (!user.isDeleted) {
    return;
  }

  logger.warn(`OAuth login rejected for a deleted account (${provider})`);
  throw providerAuthenticationFailed(provider);
}

export function providerAuthenticationFailed(provider: string): AppException {
  return new AppException(
    ErrorCode.OAUTH_AUTHENTICATION_FAILED,
    'OAuth authentication failed',
    HttpStatus.UNAUTHORIZED,
    { provider },
  );
}
