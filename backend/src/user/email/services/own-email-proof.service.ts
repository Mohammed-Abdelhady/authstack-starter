import { Injectable } from '@nestjs/common';
import {
  FRESH_PROOF_KIND,
  FRESH_PROOF_REQUIREMENT,
} from '../../../auth/contracts/constants/fresh-proof';
import { FreshProofGate } from '../../../auth/proof/fresh-proof-gate';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import { AccountProfileStore } from '../../stores/account-profile.store';
import { OWN_EMAIL_PROOF } from '../constants/own-email';
import type { OwnEmailCaller, OwnEmailProof } from '../types/own-email';
import { signInAgain } from '../utils/own-email-errors';
import { OwnEmailReauth } from './own-email-reauth.service';

/**
 * Who may steer the account's address: a browser session signed in within
 * the last five minutes, or the account's password when it has one.
 *
 * Native sessions retain the actual authentication time through browser consent.
 */
@Injectable()
export class OwnEmailProofService {
  constructor(
    private readonly freshProof: FreshProofGate,
    private readonly runner: UnitOfWorkRunner,
    private readonly passwords: AccountProfileStore,
    private readonly reauth: OwnEmailReauth,
  ) {}

  /**
   * Run before a code is hashed or a mail slot is spent.
   *
   * @throws AppException REAUTH_REQUIRED, asking for the password or for a
   *   recent sign-in, when neither the session nor a password proves it
   * @throws AppException INVALID_CURRENT_PASSWORD for a wrong password
   */
  async prove(
    caller: OwnEmailCaller,
    password: string | undefined,
  ): Promise<OwnEmailProof> {
    const fresh = await this.runner.run((unitOfWork) =>
      this.isFreshIn(unitOfWork, caller),
    );
    if (fresh) return OWN_EMAIL_PROOF.SESSION;
    const holder = await this.passwords.findPassword(caller.userId);
    await this.reauth.assertPasswordInstead(holder ?? {}, password);
    return OWN_EMAIL_PROOF.PASSWORD;
  }

  /**
   * Inside the unit of work that writes, a session proof must still hold. A
   * password stays proved for the request it came with.
   *
   * @throws AppException REAUTH_REQUIRED when the session proof lapsed
   */
  async assertStillProvedIn(
    unitOfWork: UnitOfWork,
    caller: OwnEmailCaller,
    proof: OwnEmailProof,
  ): Promise<void> {
    if (proof === OWN_EMAIL_PROOF.PASSWORD) {
      await this.isFreshIn(unitOfWork, caller);
      return;
    }
    if (!(await this.isFreshIn(unitOfWork, caller))) throw signInAgain();
  }

  private async isFreshIn(
    unitOfWork: UnitOfWork,
    caller: OwnEmailCaller,
  ): Promise<boolean> {
    try {
      await this.freshProof.assertFresh(
        unitOfWork,
        {
          userId: caller.userId,
          clientId: caller.clientId,
          sessionId: caller.sessionId,
          signedInAt: caller.signedInAt,
        },
        FRESH_PROOF_REQUIREMENT.ACT_OR_AGE,
      );
      return true;
    } catch (error) {
      if (
        error instanceof AppException &&
        error.code === ErrorCode.REAUTH_REQUIRED
      ) {
        const methods = error.details?.methods;
        if (
          Array.isArray(methods) &&
          !methods.includes(FRESH_PROOF_KIND.EMAIL_CODE)
        )
          throw error;
        return false;
      }
      throw error;
    }
  }
}
