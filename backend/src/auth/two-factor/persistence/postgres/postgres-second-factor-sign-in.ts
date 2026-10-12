import { Response } from 'express';
import { AuthenticatedUserSummary } from '../../../interfaces/authenticated-user.interface';
import { SignInCompletion } from '../../../services/sessions/sign-in-completion';
import { SecondFactorAccount } from '../../stores/second-factor-account';
import { SecondFactorSignIn } from '../../stores/second-factor-sign-in';
import { signInAccountOf } from '../../../persistence/postgres/postgres-sign-in-accounts';

/** Issues the session an account is owed once its second factor checked out. */
export class PostgresSecondFactorSignIn extends SecondFactorSignIn {
  constructor(private readonly completion: SignInCompletion) {
    super();
  }

  issueSession(
    account: SecondFactorAccount,
    response: Response,
  ): Promise<AuthenticatedUserSummary> {
    return this.completion.issueSession(signInAccountOf(account), response);
  }
}
