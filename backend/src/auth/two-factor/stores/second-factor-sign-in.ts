import { Response } from 'express';
import { AuthenticatedUserSummary } from '../../interfaces/authenticated-user.interface';
import { SecondFactorAccount } from './second-factor-account';

/**
 * The session an account is owed once its second factor checked out. It is
 * the shared sign-in's own session issue, with no second factor check.
 */
export abstract class SecondFactorSignIn {
  abstract issueSession(
    account: SecondFactorAccount,
    response: Response,
  ): Promise<AuthenticatedUserSummary>;
}
