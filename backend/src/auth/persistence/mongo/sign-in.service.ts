import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { toStoredAccount } from '../../../user/persistence/mongo/mongo-account-records';
import { UserDocument } from '../../../user/persistence/mongo/schemas/user.schema';
import { FirstFactor } from '../../services/sessions/first-factor'; // feature:totp
import {
  SignInCompletion,
  SignInOutcome,
} from '../../services/sessions/sign-in-completion';
import { AuthenticatedUserSummary } from '../../utils/authenticated-user.util';

export type { SignInOutcome };

/**
 * The MongoDB face of the last step of a sign-in, for the adapters that hold
 * the account as a document. Every decision is `SignInCompletion`'s; this
 * hands it the account the document describes.
 */
@Injectable()
export class SignInService {
  constructor(private readonly completion: SignInCompletion) {}

  completeSignIn(
    user: UserDocument,
    response: Response,
    firstFactor: FirstFactor, // feature:totp
  ): Promise<SignInOutcome> {
    return this.completion.completeSignIn(
      toStoredAccount(user),
      response,
      firstFactor, // feature:totp
    );
  }

  issueSession(
    user: UserDocument,
    response: Response,
  ): Promise<AuthenticatedUserSummary> {
    return this.completion.issueSession(toStoredAccount(user), response);
  }
}
