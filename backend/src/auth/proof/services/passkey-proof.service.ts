// feature:passkeys:start
import { timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import { Clock } from '../../../common/services/clock';
import { isStoreOutage } from '../../../common/persistence/store-failure';
import { SENSITIVE_ACTION_WINDOW_MS } from '../../../session/constants/session-policy';
import { hashToken } from '../../../session/utils/hashing/token-hash';
import { ApplicationPolicyReader } from '../../contracts/application-policy';
import { FRESH_PROOF_KIND } from '../../contracts/constants/fresh-proof';
import { USER_VERIFICATION } from '../../passkeys/constants/passkeys.constants';
import { PasskeyCredentialDto } from '../../passkeys/dto/passkey-credential.dto';
import { PasskeyConfigService } from '../../passkeys/services/passkey-config.service';
import {
  WebAuthnAdapter,
  type AssertionVerification,
} from '../../passkeys/services/webauthn.adapter';
import {
  COUNTER_OUTCOME,
  PasskeyStore,
  type StoredPasskey,
} from '../../passkeys/stores/passkey.store';
import {
  belongsTo,
  relyingPartyScope,
} from '../../passkeys/utils/relying-party.util';
import { PROOF_CHALLENGE_LIFETIME_MS } from '../constants/proof';
import { PASSKEY_PROOF_MAX_ATTEMPTS } from '../constants/passkey-proof';
import { SessionProofStore } from '../stores/session-proof.store';
import type { ActingSession } from '../types/acting-session';
import { assertionChallenge } from '../utils/assertion-challenge';

@Injectable()
export class PasskeyProofService {
  constructor(
    private readonly runner: UnitOfWorkRunner,
    private readonly proofs: SessionProofStore,
    private readonly policies: ApplicationPolicyReader,
    private readonly passkeys: PasskeyStore,
    private readonly adapter: WebAuthnAdapter,
    private readonly config: PasskeyConfigService,
    private readonly clock: Clock,
  ) {}

  async options(session: ActingSession) {
    return this.runner.run(async (work) => {
      const policy = await this.policies.requireEnabled(work, session.clientId);
      const relyingParty = policy.passkeyRelyingParty;
      if (!relyingParty) {
        throw new AppException(
          ErrorCode.FEATURE_DISABLED,
          'Passkey proof is unavailable for this application',
          HttpStatus.FORBIDDEN,
        );
      }
      const descriptors = await this.passkeys.listDescriptorsFor(
        session.userId,
        relyingPartyScope(relyingParty.rpId, this.config.rpId),
        work,
      );
      const options = await this.adapter.createAuthenticationOptions({
        rpId: relyingParty.rpId,
        allowCredentials: descriptors.map(({ credentialId, transports }) => ({
          id: credentialId,
          transports,
        })),
        userVerification: USER_VERIFICATION.REQUIRED,
      });
      const expiresAt = new Date(
        this.clock.now().getTime() + PROOF_CHALLENGE_LIFETIME_MS,
      );
      await this.proofs.openChallenge(work, {
        ...session,
        kind: FRESH_PROOF_KIND.PASSKEY,
        challengeHash: hashToken(options.challenge),
        expiresAt,
        purgeAfter: expiresAt,
      });
      return options;
    });
  }

  async verify(
    session: ActingSession,
    credential: PasskeyCredentialDto,
  ): Promise<{ provedAt: Date }> {
    try {
      const stored = await this.runner.run(async (work) => {
        const challenge = await this.proofs.takeChallenge(
          work,
          session,
          FRESH_PROOF_KIND.PASSKEY,
        );
        if (challenge) {
          // Spending before verification survives every later refusal.
          await this.proofs.recordWrongGuess(
            work,
            session,
            PASSKEY_PROOF_MAX_ATTEMPTS,
          );
        }
        return challenge;
      });
      const { challenge, challengeHash } = assertionChallenge(
        credential.response,
      );
      if (!stored || stored.expiresAt.getTime() <= this.clock.now().getTime())
        throw this.failed();
      const presented = Buffer.from(challengeHash, 'hex');
      const expected = Buffer.from(stored.challengeHash, 'hex');
      if (
        presented.length !== expected.length ||
        !timingSafeEqual(presented, expected)
      )
        throw this.failed();
      const provedAt = await this.runner.run((work) =>
        this.prove(work, session, credential, challenge),
      );
      return { provedAt };
    } catch (error) {
      // A database outage keeps its own answer; any other failure is one refusal.
      if (isStoreOutage(error)) throw error;
      throw this.failed();
    }
  }

  private async prove(
    work: UnitOfWork,
    session: ActingSession,
    credential: PasskeyCredentialDto,
    challenge: string,
  ): Promise<Date> {
    const policy = await this.policies.requireEnabled(work, session.clientId);
    const relyingParty = policy.passkeyRelyingParty;
    const origin = relyingParty?.origins[0];
    if (!relyingParty || !origin) throw this.failed();
    const passkey = await this.passkeys.findByCredentialId(credential.id, work);
    if (
      !passkey ||
      passkey.userId !== session.userId ||
      !belongsTo(passkey, relyingParty.rpId, this.config.rpId)
    )
      throw this.failed();
    const verified = await this.adapter.verifyAssertion(
      credential,
      {
        id: passkey.credentialId,
        publicKey: passkey.publicKey,
        counter: passkey.counter,
        transports: passkey.transports,
      },
      { challenge, origin, rpId: relyingParty.rpId },
      USER_VERIFICATION.REQUIRED,
    );
    if (
      !verified ||
      !verified.userVerified ||
      (passkey.counter > 0 && verified.newCounter <= passkey.counter)
    )
      throw this.failed();
    const provedAt = this.clock.now();
    await this.recordCredentialUse(work, passkey, verified, provedAt);
    await this.proofs.recordProof(work, {
      ...session,
      kind: FRESH_PROOF_KIND.PASSKEY,
      rpId: relyingParty.rpId,
      userVerified: true,
      provedAt,
      purgeAfter: new Date(provedAt.getTime() + SENSITIVE_ACTION_WINDOW_MS),
    });
    return provedAt;
  }

  private async recordCredentialUse(
    work: UnitOfWork,
    passkey: StoredPasskey,
    verified: AssertionVerification,
    provedAt: Date,
  ): Promise<void> {
    if (passkey.counter === 0 && verified.newCounter === 0) {
      await this.passkeys.markUsed(passkey, provedAt, work);
      return;
    }
    const outcome = await this.passkeys.advanceCounter(
      passkey,
      { counter: verified.newCounter, usedAt: provedAt },
      work,
    );
    if (outcome !== COUNTER_OUTCOME.ADVANCED) throw this.failed();
  }

  private failed(): AppException {
    return new AppException(
      ErrorCode.PASSKEY_VERIFICATION_FAILED,
      'The passkey proof could not be verified',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
// feature:passkeys:end
