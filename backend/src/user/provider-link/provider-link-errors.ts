import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';

/** Unknown, spent, lapsed, someone else's, or a proof for another nonce. */
export function linkStateInvalid(): AppException {
  return new AppException(
    ErrorCode.OAUTH_STATE_INVALID,
    'This link expired or was already used. Start it again.',
    HttpStatus.BAD_REQUEST,
  );
}

export function linkUnavailable(provider: string): AppException {
  return new AppException(
    ErrorCode.FEATURE_DISABLED,
    `This app cannot link ${provider}`,
    HttpStatus.FORBIDDEN,
    { provider },
  );
}

export function alreadyLinked(provider: string): AppException {
  return new AppException(
    ErrorCode.PROVIDER_ALREADY_LINKED,
    `${provider} is already linked to your account`,
    HttpStatus.CONFLICT,
    { provider },
  );
}
