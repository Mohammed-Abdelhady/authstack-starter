import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { Clock } from '../../../common/services/clock';
import { HashService } from '../../../common/services/hash.service';
import { SENSITIVE_ACTION_WINDOW_MS } from '../../../session/constants/session-policy';
import { AccountProfileStore } from '../../../user/stores/account-profile.store';
import { ApplicationPolicyReader } from '../../contracts/application-policy';
import { FRESH_PROOF_KIND } from '../../contracts/constants/fresh-proof';
import { FreshProofSender } from '../../contracts/fresh-proof';
import { generateVerificationCode } from '../../utils/verification-code.util';
import {
  PROOF_CODE_LIFETIME_MS,
  PROOF_MAX_WRONG_GUESSES,
} from '../constants/proof';
import { SessionProofStore } from '../stores/session-proof.store';
import type { ActingSession } from '../types/acting-session';

@Injectable()
export class EmailProofService {
  constructor(
    private readonly runner: UnitOfWorkRunner,
    private readonly proofs: SessionProofStore,
    private readonly policies: ApplicationPolicyReader,
    private readonly accounts: AccountProfileStore,
    private readonly hash: HashService,
    private readonly clock: Clock,
    private readonly sender: FreshProofSender,
  ) {}

  async send(session: ActingSession): Promise<{ expiresInMinutes: number }> {
    const code = generateVerificationCode();
    const challengeHash = await this.hash.hash(code);
    const recipient = await this.runner.run(async (work) => {
      const policy = await this.policies.requireEnabled(work, session.clientId);
      this.assertEmailAllowed(policy.requirePasskey);
      const account = await this.accounts.readAccount(work, session.userId);
      if (!account || account.isDeleted) {
        throw new AppException(
          ErrorCode.SESSION_REQUIRED,
          'A signed-in account is required',
          HttpStatus.UNAUTHORIZED,
        );
      }
      const expiresAt = new Date(
        this.clock.now().getTime() + PROOF_CODE_LIFETIME_MS,
      );
      await this.proofs.openChallenge(work, {
        ...session,
        kind: FRESH_PROOF_KIND.EMAIL_CODE,
        challengeHash,
        expiresAt,
        purgeAfter: expiresAt,
      });
      return { email: account.email, locale: account.locale };
    });
    const expiresInMinutes = PROOF_CODE_LIFETIME_MS / 60_000;
    await this.sender.sendProofCode({ recipient, code, expiresInMinutes });
    return { expiresInMinutes };
  }

  async verify(
    session: ActingSession,
    code: string,
  ): Promise<{ provedAt: Date }> {
    const provedAt = await this.runner.run(async (work) => {
      const policy = await this.policies.requireEnabled(work, session.clientId);
      this.assertEmailAllowed(policy.requirePasskey);
      const challenge = await this.proofs.takeChallenge(
        work,
        session,
        FRESH_PROOF_KIND.EMAIL_CODE,
      );
      if (
        !challenge ||
        challenge.expiresAt.getTime() <= this.clock.now().getTime()
      ) {
        await this.hash.spendComparison(code);
        return null;
      }
      if (!(await this.hash.compare(code, challenge.challengeHash))) {
        await this.proofs.recordWrongGuess(
          work,
          session,
          PROOF_MAX_WRONG_GUESSES,
        );
        return null;
      }
      const now = this.clock.now();
      await this.proofs.recordProof(work, {
        ...session,
        kind: FRESH_PROOF_KIND.EMAIL_CODE,
        userVerified: false,
        provedAt: now,
        purgeAfter: new Date(now.getTime() + SENSITIVE_ACTION_WINDOW_MS),
      });
      return now;
    });
    // Refuse after commit so a wrong guess cannot roll back its counter.
    if (!provedAt) {
      throw new AppException(
        ErrorCode.ACTIVATION_CODE_INVALID,
        'The proof code is invalid or expired',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return { provedAt };
  }

  private assertEmailAllowed(requirePasskey: boolean | undefined): void {
    if (requirePasskey === true) {
      throw new AppException(
        ErrorCode.FEATURE_DISABLED,
        'This application requires passkey proof',
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
