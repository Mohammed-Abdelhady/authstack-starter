import { Injectable } from '@nestjs/common';
import { FRESH_PROOF_REQUIREMENT } from '../../../auth/contracts/constants/fresh-proof';
import { FreshProofCheck } from '../../../auth/contracts/fresh-proof';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import { CREDENTIAL_PURPOSE } from '../../../session/constants/credential-purpose';
import { AccountProfileStore } from '../../stores/account-profile.store';
import { OWN_EMAIL_PROOF } from '../constants/own-email';
import type { OwnEmailCaller, OwnEmailProof } from '../types/own-email';
import { signInAgain } from '../utils/own-email-errors';
import { OwnEmailReauth } from './own-email-reauth.service';

/**
 * Who may steer the account's address: a browser session signed in within
 * the last five minutes, or the account's password when it has one.
 *
 * A mobile session's age proves nothing yet. One made by approving a browser
 * sign-in is issued at the approval, so a browser left signed in for hours
 * could mint a session that looks fresh.
 */
@Injectable()
export class OwnEmailProofService {
  constructor(
    private readonly freshProof: FreshProofCheck,
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
    if (proof === OWN_EMAIL_PROOF.PASSWORD) return;
    if (!(await this.isFreshIn(unitOfWork, caller))) throw signInAgain();
  }

  private isFreshIn(
    unitOfWork: UnitOfWork,
    caller: OwnEmailCaller,
  ): Promise<boolean> {
    const ageCounts =
      caller.credentialPurpose === CREDENTIAL_PURPOSE.BROWSER_SESSION;
    return this.freshProof.isFresh(unitOfWork, {
      userId: caller.userId,
      clientId: caller.clientId,
      sessionId: caller.sessionId,
      signedInAt: caller.signedInAt,
      requirement: ageCounts
        ? FRESH_PROOF_REQUIREMENT.ACT_OR_AGE
        : FRESH_PROOF_REQUIREMENT.ACT,
      requirePasskey: false,
    });
  }
}
