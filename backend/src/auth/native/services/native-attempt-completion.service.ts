import {
  assertPasskeySignIn,
  NATIVE_PASSKEY_AUTHENTICATION_METHOD,
} from '../../../session/utils/authority/passkey-sign-in';
import { ErasureRefusal } from '../../../user/erasure/services/erasure-refusal';
import { Optional } from '@nestjs/common';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { NativeAttemptView } from '@app/sdk';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { Clock } from '../../../common/services/clock';
import { ApplicationRegistry } from '../../../session/applications/application-registry';
import { ApplicationAccessStore } from '../../../session/applications/application-access.store';
import { BrowserIssuanceStore } from '../../../session/issuance/browser-issuance.store';
import { NativeAuthorizeService } from '../../../session/native/authorize/native-authorize.service';
import { assertAudienceAdmission } from '../../../session/utils/authority/audience-admission';
import { AccountProfileStore } from '../../../user/stores/account-profile.store';
import { ApplicationPolicyReader } from '../../contracts/application-policy';
import { AuthFeature } from '../../enums/auth-feature.enum'; // feature:totp
import { AuthFeaturesService } from '../../services/features/auth-features.service'; // feature:totp
import { PasskeyStore } from '../../passkeys/stores/passkey.store'; // feature:passkeys
import { PasskeyConfigService } from '../../passkeys/services/passkey-config.service'; // feature:passkeys
import { relyingPartyScope } from '../../passkeys/utils/relying-party.util'; // feature:passkeys
import {
  NATIVE_ATTEMPT_FIRST_FACTOR, // feature:totp,passkeys
  NATIVE_ATTEMPT_PHASE,
} from '../constants/native-attempt';
import { NativeAttemptStore } from '../stores/native-attempt.store';
import type {
  NativeAttempt,
  NativeAttemptDetails,
  VerifiedNativePrincipal,
} from '../types/native-attempt';
import { operationGuardOf } from '../utils/native-attempt-guards';
import { wrongStage } from '../utils/native-attempt-errors';
import { isFirstFactorClaim } from '../utils/native-first-factor-claim';
import { assertNativePolicy } from '../utils/native-policy.util';
import { nativeCompletionDetails } from '../utils/native-completion-details';
import { encryptCodeReply, decryptCodeReply } from '../utils/native-code-reply';
import { NativeMethodsService } from './native-methods.service';

@Injectable()
export class NativeAttemptCompletionService {
  constructor(
    private readonly attempts: NativeAttemptStore,
    private readonly methods: NativeMethodsService,
    private readonly authorize: NativeAuthorizeService,
    private readonly registry: ApplicationRegistry,
    private readonly grants: ApplicationAccessStore,
    private readonly issuance: BrowserIssuanceStore,
    private readonly accounts: AccountProfileStore,
    private readonly features: AuthFeaturesService, // feature:totp
    private readonly clock: Clock,
    private readonly epoch: AuthEpochService,
    private readonly policy: ApplicationPolicyReader,
    private readonly passkeys: PasskeyStore, // feature:passkeys
    private readonly passkeyConfig: PasskeyConfigService, // feature:passkeys
    @Optional() private readonly erasure?: ErasureRefusal,
  ) {}

  async afterFirstFactorIn(
    work: UnitOfWork,
    claimed: NativeAttempt,
    principal: VerifiedNativePrincipal,
    secret: string,
  ): Promise<NativeAttempt> {
    assertNativePolicy(
      claimed,
      this.methods.policyHash(claimed.clientId),
      this.epoch.current(),
    );
    if (
      !isFirstFactorClaim(claimed, principal) ||
      !claimed.activeOperationId ||
      !principal.userId ||
      !Array.isArray(principal.authenticationMethods) ||
      principal.authenticationMethods.length === 0
    )
      throw wrongStage();
    const authority = await this.issuance.readAccountForIssuance(
      work,
      principal.userId,
    );
    if (authority?.isDeleted)
      throw (
        (await this.erasure?.refusalFor(principal.userId, wrongStage())) ??
        wrongStage()
      );
    if (
      !authority ||
      authority.isDeleted ||
      authority.sessionVersion !== principal.userVersion
    )
      throw wrongStage();
    const account = await this.accounts.readAccount(work, principal.userId);
    const client = await this.registry.findClientIn(work, claimed.clientId);
    if (
      !account ||
      account.isDeleted ||
      account.sessionVersion !== principal.userVersion ||
      !client ||
      !client.enabled
    )
      throw wrongStage();
    const policy = await this.policy.requireEnabled(work, claimed.clientId);
    assertAudienceAdmission(authority.accountAudience, policy.accountAudience);
    assertPasskeySignIn(
      policy.requirePasskey,
      {
        authenticationMethods: principal.authenticationMethods,
        userVerified: principal.passkeyUserVerified === true,
      },
      NATIVE_PASSKEY_AUTHENTICATION_METHOD,
    );
    const grant = await this.grants.takeGrantForChange(
      work,
      account.id,
      claimed.clientId,
    );
    if (grant && !grant.allowed) throw wrongStage();
    const owesMfa = Boolean(
      // feature:totp:start
      account.twoFactorEnabled &&
      this.features.isEnabled(AuthFeature.TWO_FACTOR) &&
      !(
        principal.firstFactor === NATIVE_ATTEMPT_FIRST_FACTOR.PASSKEY &&
        principal.passkeyUserVerified === true
      ),
      // feature:totp:end
    );
    // feature:passkeys:start
    const methods = owesMfa
      ? await this.methods.forClient(claimed.clientId)
      : null;
    // feature:passkeys:end
    const passkeyEligible = Boolean(
      // feature:passkeys:start
      owesMfa &&
      principal.firstFactor !== NATIVE_ATTEMPT_FIRST_FACTOR.PASSKEY &&
      methods?.capabilities.passkeys === true &&
      policy.passkeyRelyingParty !== null &&
      (
        await this.passkeys.listDescriptorsFor(
          account.id,
          relyingPartyScope(
            policy.passkeyRelyingParty.rpId,
            this.passkeyConfig.rpId,
          ),
          work,
        )
      ).length > 0,
      // feature:passkeys:end
    );
    const details: NativeAttemptDetails = {
      ...claimed.details,
      verifiedAccount: {
        userId: account.id,
        userVersion: principal.userVersion,
        clientVersion: client.sessionVersion,
        grantVersion: grant?.sessionVersion ?? null,
        authenticationMethods: principal.authenticationMethods.slice(0, 10),
        firstFactor: principal.firstFactor,
        userVerified: principal.passkeyUserVerified === true,
        verifiedAt: this.clock.now(),
      },
      secondFactors: owesMfa
        ? passkeyEligible
          ? ['totp', 'recoveryCode', 'passkey']
          : ['totp', 'recoveryCode']
        : undefined,
    };
    if (!owesMfa) return this.finishIn(work, claimed, details, secret);
    const completed = await this.attempts.transitionIn(
      work,
      operationGuardOf(claimed),
      {
        phase: NATIVE_ATTEMPT_PHASE.SECOND_FACTOR_REQUIRED,
        expiresAt: claimed.expiresAt,
        details,
      },
    );
    if (!completed) throw wrongStage();
    return completed;
  }

  async afterLastFactorIn(
    work: UnitOfWork,
    claimed: NativeAttempt,
    factor: { method: string; userVerified: boolean; secret: string },
  ): Promise<NativeAttempt> {
    const principal = claimed.details.verifiedAccount;
    if (!principal || !claimed.activeOperationId) throw wrongStage();
    const account = await this.issuance.findAccount(work, principal.userId);
    const client = await this.registry.findClientIn(work, claimed.clientId);
    if (!account || account.isDeleted || !client || !client.enabled)
      throw wrongStage();
    assertAudienceAdmission(account.accountAudience, client.accountAudience);
    return this.finishIn(
      work,
      claimed,
      nativeCompletionDetails(claimed.details, principal, factor),
      factor.secret,
    );
  }

  async finishIn(
    work: UnitOfWork,
    claimed: NativeAttempt,
    details: NativeAttemptDetails,
    secret: string,
  ): Promise<NativeAttempt> {
    const application = this.epoch
      .nativeApplications()
      .find((entry) => entry.clientId === claimed.clientId);
    if (application?.firstParty === true) {
      return this.sealCodeIn(work, { ...claimed, details }, secret);
    }
    const result = await this.attempts.transitionIn(
      work,
      operationGuardOf(claimed),
      {
        phase: NATIVE_ATTEMPT_PHASE.CONSENT_REQUIRED,
        expiresAt: claimed.expiresAt,
        details,
      },
    );
    if (!result) throw wrongStage();
    return result;
  }

  async sealCodeIn(
    work: UnitOfWork,
    claimed: NativeAttempt,
    secret: string,
  ): Promise<NativeAttempt> {
    const principal = claimed.details.verifiedAccount;
    if (!principal || !claimed.activeOperationId) throw wrongStage();
    const approved = await this.authorize.approveVerifiedIn(
      work,
      claimed,
      principal,
    );
    const codeReply = encryptCodeReply(
      claimed,
      secret,
      approved.redirectUri,
      approved.expiresAt,
    );
    const result = await this.attempts.transitionIn(
      work,
      operationGuardOf(claimed),
      {
        phase: NATIVE_ATTEMPT_PHASE.CODE_READY,
        expiresAt: claimed.expiresAt,
        details: {
          ...claimed.details,
          verifiedAccount: {
            ...principal,
            grantVersion: approved.grantVersion,
          },
          codeReply,
        },
      },
    );
    if (!result) throw wrongStage();
    return result;
  }

  codeReadyView(attempt: NativeAttempt, secret: string): NativeAttemptView {
    const reply = attempt.details.codeReply;
    if (!reply || reply.expiresAt.getTime() <= this.clock.now().getTime()) {
      throw new AppException(
        ErrorCode.NATIVE_TRANSACTION_EXPIRED,
        'Native code expired',
        HttpStatus.GONE,
      );
    }
    let redirectUri: string;
    try {
      redirectUri = decryptCodeReply(attempt, secret);
    } catch {
      throw wrongStage();
    }
    return {
      attemptId: attempt.attemptId,
      expiresAt: attempt.expiresAt.toISOString(),
      stage: 'codeReady',
      redirectUri,
      activationCompleted: attempt.details.activationCompleted,
    };
  }
}
