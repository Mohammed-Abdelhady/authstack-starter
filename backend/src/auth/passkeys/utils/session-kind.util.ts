import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import {
  CREDENTIAL_PURPOSE,
  CredentialPurpose,
} from '../../../session/constants/credential-purpose';

/** What the registration routes read of the session a request arrived on. */
export interface RegisteringSession {
  id: string;
  createdAt: Date;
  /** The application the session belongs to. */
  clientId: string;
  /** Absent reads as a browser session. */
  credentialPurpose?: CredentialPurpose;
}

/**
 * A session that exists only to enrol the first passkey, as the guard read it
 * from the store for this request.
 */
export function isEnrolmentSession(
  session: Pick<RegisteringSession, 'credentialPurpose'> | undefined,
): boolean {
  return session?.credentialPurpose === CREDENTIAL_PURPOSE.ENROLMENT;
}

/** A session a mobile access token opened. */
export function isNativeSession(
  session: Pick<RegisteringSession, 'credentialPurpose'> | undefined,
): boolean {
  return session?.credentialPurpose === CREDENTIAL_PURPOSE.NATIVE_ACCESS;
}

/** The answer to a route called with the other kind of credential. */
export function wrongCredentialKind(): AppException {
  return new AppException(
    ErrorCode.FORBIDDEN,
    'This route does not take this kind of sign-in',
    HttpStatus.FORBIDDEN,
  );
}
