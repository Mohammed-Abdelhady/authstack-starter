import type { Response } from 'express';
import type { UnitOfWorkRunner } from '../../common/persistence/unit-of-work';
import type { SignInAccount } from '../utils/authenticated-user.util';
import type { SignInCompletion } from '../services/sessions/sign-in-completion';
import { FIRST_FACTOR } from '../services/sessions/first-factor';
import { assertBrowserProviderAdmission } from './browser-provider-policy';

export function completeBrowserProviderSignIn(
  runner: UnitOfWorkRunner,
  signIn: SignInCompletion,
  request: { user: SignInAccount; response: Response },
) {
  return runner.run((work) =>
    signIn.completeSignInIn(work, {
      ...request,
      firstFactor: FIRST_FACTOR.PROVIDER,
      admit: assertBrowserProviderAdmission,
    }),
  );
}
