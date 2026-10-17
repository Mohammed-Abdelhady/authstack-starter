import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import type { IssuanceApplication } from '../../session/issuance/browser-issuance.store';

type BrowserProviderPolicy = { readonly oauth?: boolean } | null | undefined;

export function browserProviderSignInAllowed(
  policy: BrowserProviderPolicy,
): boolean {
  return policy?.oauth !== false;
}

export function assertBrowserProviderSignIn(
  policy: BrowserProviderPolicy,
): void {
  if (!browserProviderSignInAllowed(policy)) {
    throw new AppException(
      ErrorCode.FEATURE_DISABLED,
      'Provider sign-in is disabled for this application',
      HttpStatus.NOT_FOUND,
      { feature: 'oauth' },
    );
  }
}

export function assertBrowserProviderAdmission(
  application: IssuanceApplication,
): void {
  assertBrowserProviderSignIn(application.signInMethods);
}
