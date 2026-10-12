import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { AuthenticatedUserSummary } from '../../../interfaces/authenticated-user.interface';
import { SignInService } from '../../../persistence/mongo/sign-in.service';
import { SecondFactorAccount } from '../../stores/second-factor-account';
import { SecondFactorSignIn } from '../../stores/second-factor-sign-in';
import { secondFactorDocumentOf } from './mongo-second-factor.store';

/**
 * Hands the account to the sign-in service, which still takes a document. It
 * goes away when sign-in takes an account id.
 */
@Injectable()
export class MongoSecondFactorSignIn extends SecondFactorSignIn {
  constructor(private readonly signInService: SignInService) {
    super();
  }

  issueSession(
    account: SecondFactorAccount,
    response: Response,
  ): Promise<AuthenticatedUserSummary> {
    return this.signInService.issueSession(
      secondFactorDocumentOf(account),
      response,
    );
  }
}
