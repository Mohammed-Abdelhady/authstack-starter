import type { AccountCreationMethod } from '../../types/account-creation';
import type { BrowserEvidence } from '../../../session/types/browser-evidence';
import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { toStoredAccount } from '../../../user/persistence/mongo/mongo-account-records';
import { UserDocument } from '../../../user/persistence/mongo/schemas/user.schema';
import { FirstFactor } from '../../services/sessions/first-factor';
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

  assertAdmission(userId: string, response: Response): Promise<void> {
    return this.completion.assertAdmission(userId, response);
  }

  recordCreationRefusal(
    clientId: string,
    method: AccountCreationMethod,
  ): Promise<void> {
    return this.completion.recordCreationRefusal(clientId, method);
  }

  completeSignIn(
    user: UserDocument,
    response: Response,
    firstFactor?: FirstFactor,
  ): Promise<SignInOutcome> {
    return this.completion.completeSignIn(
      toStoredAccount(user),
      response,
      firstFactor,
    );
  }

  issueSession(
    user: UserDocument,
    response: Response,
    evidence?: BrowserEvidence,
  ): Promise<AuthenticatedUserSummary> {
    return this.completion.issueSession(
      toStoredAccount(user),
      response,
      evidence,
    );
  }
}
