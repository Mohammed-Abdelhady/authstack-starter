import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type {
  NativeAttemptView,
  NativePasskeyAssertion,
  NativePasskeyOptions,
} from '@app/sdk';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { Clock } from '../../../common/services/clock';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { runLeavingFailuresAsRaised } from '../../../common/persistence/store-failure';
import { AccountProfileStore } from '../../../user/stores/account-profile.store';
import {
  PasskeyStore,
  COUNTER_OUTCOME,
} from '../../passkeys/stores/passkey.store';
import { WebAuthnAdapter } from '../../passkeys/services/webauthn.adapter';
import {
  belongsTo,
  relyingPartyScope,
} from '../../passkeys/utils/relying-party.util';
import { PasskeyConfigService } from '../../passkeys/services/passkey-config.service';
import {
  NativeRelyingParties,
  PasskeyRelyingParty,
} from '../../passkeys/native/native-relying-parties';
import { NativeAttemptService } from '../services/native-attempt.service';
import { NativeAttemptCompletionService } from '../services/native-attempt-completion.service';
import { NativeMethodsService } from '../services/native-methods.service';
import {
  NATIVE_ATTEMPT_FIRST_FACTOR,
  NATIVE_ATTEMPT_FLOW,
  NATIVE_ATTEMPT_PHASE,
} from '../constants/native-attempt';
import type { NativeAttempt } from '../types/native-attempt';
import {
  digest,
  safeEqual,
  assertHandle,
  isAssertion,
} from './utils/native-passkey-assertion';
import {
  featureDisabled,
  invalidRequest,
  wrongStage,
} from '../utils/native-attempt-errors';
import { assertNativePolicy } from '../utils/native-policy.util';

@Injectable()
export class NativePasskeyService {
  constructor(
    private readonly attempts: NativeAttemptService,
    private readonly completion: NativeAttemptCompletionService,
    private readonly methods: NativeMethodsService,
    private readonly credentials: PasskeyStore,
    private readonly adapter: WebAuthnAdapter,
    private readonly accounts: AccountProfileStore,
    private readonly epoch: AuthEpochService,
    private readonly clock: Clock,
    private readonly runner: UnitOfWorkRunner,
    private readonly relyingParties: NativeRelyingParties,
    private readonly passkeyConfig: PasskeyConfigService,
  ) {}

  async options(
    attemptId: string,
    secret: string,
  ): Promise<NativePasskeyOptions> {
    const current = await this.attempts.authenticate(attemptId, secret);
    const purpose = this.purpose(current);
    const config = await this.config(current);
    const claimed = await this.attempts.claim(attemptId, secret, current.phase);
    try {
      const userId =
        purpose === 'secondFactor'
          ? claimed.details.verifiedAccount?.userId
          : undefined;
      // Only this application's relying party; a passkey stored with none is
      // the web one's, and never offered to an app with another relying party.
      const descriptors = userId
        ? await this.credentials.listDescriptorsFor(
            userId,
            relyingPartyScope(config.rpId, this.passkeyConfig.rpId),
          )
        : [];
      if (purpose === 'secondFactor' && descriptors.length === 0)
        throw featureDisabled();
      const challenge = randomBytes(32).toString('base64url');
      const options = await this.adapter.createAuthenticationOptions({
        rpId: config.rpId,
        allowCredentials: descriptors.map((item) => ({
          id: item.credentialId,
          transports: item.transports,
        })),
      });
      const updated = await this.attempts.transition(claimed, claimed.phase, {
        ...claimed.details,
        passkeyChallengeHash: digest(claimed, purpose, userId ?? '', challenge),
        passkeyPurpose: purpose,
      });
      if (updated.details.passkeyChallengeHash === undefined)
        throw wrongStage();
      return {
        challenge,
        rpId: config.rpId,
        timeout: options.timeout,
        userVerification:
          purpose === 'secondFactor' ? 'required' : options.userVerification,
        allowCredentials: descriptors.map((item) => ({
          type: 'public-key',
          id: item.credentialId,
          transports: item.transports,
        })),
      };
    } catch (error) {
      await this.attempts.release(claimed).catch(() => undefined);
      throw error;
    }
  }

  async verify(
    attemptId: string,
    secret: string,
    assertion: NativePasskeyAssertion,
  ): Promise<NativeAttemptView> {
    if (!isAssertion(assertion)) throw invalidRequest();
    const current = await this.attempts.authenticate(attemptId, secret);
    const purpose = this.purpose(current);
    const config = await this.config(current);
    const claimed = await this.attempts.claim(attemptId, secret, current.phase);
    try {
      const userId =
        purpose === 'secondFactor'
          ? (claimed.details.verifiedAccount?.userId ?? '')
          : '';
      const expectedHash = claimed.details.passkeyChallengeHash;
      if (!expectedHash || claimed.details.passkeyPurpose !== purpose)
        throw wrongStage();
      const passkey = await this.credentials.findByCredentialId(assertion.id);
      if (!passkey || (userId && passkey.userId !== userId)) throw wrongStage();
      if (!belongsTo(passkey, config.rpId, this.passkeyConfig.rpId))
        throw wrongStage();
      if (!assertHandle(assertion.response.userHandle, passkey.userId, purpose))
        throw wrongStage();
      const account = await this.accounts.findProfile(passkey.userId);
      if (!account || account.isDeleted) throw wrongStage();
      const verification = await this.adapter.verifyNativeAssertion(
        assertion,
        {
          id: passkey.credentialId,
          publicKey: passkey.publicKey,
          counter: passkey.counter,
          transports: passkey.transports,
        },
        {
          challenge: (value) =>
            safeEqual(digest(claimed, purpose, userId, value), expectedHash),
          origin: config.origins,
          rpId: config.rpId,
        },
      );
      if (
        !verification ||
        (passkey.counter > 0 && verification.newCounter <= passkey.counter)
      )
        throw wrongStage();
      const result = await runLeavingFailuresAsRaised(
        this.runner,
        async (work) => {
          assertNativePolicy(
            claimed,
            this.methods.policyHash(claimed.clientId),
            this.epoch.current(),
          );
          const live = await this.credentials.findByCredentialId(
            passkey.credentialId,
            work,
          );
          if (
            !live ||
            live.userId !== passkey.userId ||
            live.counter !== passkey.counter
          )
            throw wrongStage();
          const at = this.clock.now();
          if (live.counter > 0 || verification.newCounter > 0) {
            const moved = await this.credentials.advanceCounter(
              live,
              { counter: verification.newCounter, usedAt: at },
              work,
            );
            if (moved !== COUNTER_OUTCOME.ADVANCED) throw wrongStage();
          } else {
            await this.credentials.markUsed(live, at, work);
          }
          if (purpose === 'firstFactor') {
            return this.attempts.completeFactorIn(
              work,
              claimed,
              {
                userId: account.id,
                userVersion: account.sessionVersion,
                firstFactor: NATIVE_ATTEMPT_FIRST_FACTOR.PASSKEY,
                authenticationMethods: ['hwk'],
                passkeyUserVerified: verification.userVerified,
              },
              secret,
            );
          }
          if (
            !verification.userVerified ||
            !claimed.details.verifiedAccount ||
            claimed.details.verifiedAccount.userId !== account.id ||
            claimed.details.verifiedAccount.userVersion !==
              account.sessionVersion
          )
            throw wrongStage();
          const current = await this.accounts.readAccount(work, account.id);
          if (
            !current ||
            current.isDeleted ||
            !current.twoFactorEnabled || // feature:totp
            current.sessionVersion !== account.sessionVersion
          )
            throw wrongStage();
          return this.completion.afterLastFactorIn(work, claimed, {
            method: 'hwk',
            userVerified: true,
            secret,
          });
        },
      );
      return this.attempts.viewAfter(result, secret);
    } catch (error) {
      await this.attempts.release(claimed).catch(() => undefined);
      throw error;
    }
  }

  private purpose(attempt: NativeAttempt): 'firstFactor' | 'secondFactor' {
    if (
      attempt.phase === NATIVE_ATTEMPT_PHASE.FIRST_FACTOR_REQUIRED &&
      attempt.flow === NATIVE_ATTEMPT_FLOW.SIGN_IN
    )
      return 'firstFactor';
    if (
      attempt.phase === NATIVE_ATTEMPT_PHASE.SECOND_FACTOR_REQUIRED &&
      attempt.details.secondFactors?.includes('passkey') &&
      attempt.details.verifiedAccount?.firstFactor !==
        NATIVE_ATTEMPT_FIRST_FACTOR.PASSKEY
    )
      return 'secondFactor';
    throw wrongStage();
  }

  private async config(attempt: NativeAttempt): Promise<PasskeyRelyingParty> {
    const methods = await this.methods.forClient(attempt.clientId);
    if (!methods.capabilities.passkeys) throw featureDisabled();
    const relyingParty = this.relyingParties.of(attempt.clientId);
    if (!relyingParty) throw featureDisabled();
    return relyingParty;
  }
}
