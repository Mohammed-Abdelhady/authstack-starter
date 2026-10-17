import type { BrowserApplicationAdmission } from '../../../session/types/browser-application-admission';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { ErasureRefusal } from '../../../user/erasure/services/erasure-refusal';
import { Optional } from '@nestjs/common';
import type { AccountCreationMethod } from '../../types/account-creation';
import {
  Injectable,
  HttpStatus, // feature:totp
  Logger, // feature:totp
} from '@nestjs/common';
import { Response } from 'express';
import { BrowserApplications } from '../../../session/applications/browser-applications';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum'; // feature:totp
import { RolePermissions } from '../../../role/stores/role-permissions';
import { Sessions } from './sessions';
import { CSRF_HEADER } from '../../../session/constants/browser-proof';
import { SessionCookieService } from './session-cookie.service';
import { FirstFactor } from './first-factor';
import type { BrowserEvidence } from '../../../session/types/browser-evidence';
import { AuthFeaturesService } from '../features/auth-features.service'; // feature:totp
import { AuthFeature } from '../../enums/auth-feature.enum'; // feature:totp
import {
  AuthenticatedUserSummary,
  SignInAccount,
  toAuthenticatedUser,
} from '../../utils/authenticated-user.util';
import { SignInOutcome } from '../../interfaces/authenticated-user.interface';
import { TwoFactorChallengeService } from '../../two-factor/services/two-factor-challenge.service'; // feature:totp

export type { SignInOutcome };

// Log lines keep the context they were written under before this class existed.
const LOG_CONTEXT = 'SignInService'; // feature:totp

/**
 * The last step of every sign-in, shared by password, magic link and OAuth.
 * Keeping it in one place is what stops a new sign-in route from quietly
 * skipping the second factor.
 */
@Injectable()
export class SignInCompletion {
  private readonly logger = new Logger(LOG_CONTEXT); // feature:totp

  constructor(
    private readonly roles: RolePermissions,
    private readonly sessionService: Sessions,
    private readonly sessionCookieService: SessionCookieService,
    private readonly authFeaturesService: AuthFeaturesService, // feature:totp
    private readonly challengeService: TwoFactorChallengeService, // feature:totp
    private readonly applications: BrowserApplications,
    @Optional() private readonly erasure?: ErasureRefusal,
  ) {}

  /**
   * Finishes a sign-in for a user who cleared their first factor. An account
   * with a confirmed second factor gets a challenge cookie instead of a
   * session.
   */
  async completeSignIn(
    user: SignInAccount,
    response: Response,
    firstFactor?: FirstFactor,
  ): Promise<SignInOutcome> {
    return this.complete(user, response, {
      firstFactor,
      work: undefined,
      admit: undefined,
    });
  }

  completeSignInIn(
    work: UnitOfWork,
    request: {
      user: SignInAccount;
      response: Response;
      firstFactor: FirstFactor;
      admit?: BrowserApplicationAdmission | undefined;
    },
  ): Promise<SignInOutcome> {
    return this.complete(request.user, request.response, {
      firstFactor: request.firstFactor,
      work,
      admit: request.admit,
    });
  }

  private async complete(
    user: SignInAccount,
    response: Response,
    context: {
      firstFactor: FirstFactor | undefined;
      work: UnitOfWork | undefined;
      admit: BrowserApplicationAdmission | undefined;
    },
  ): Promise<SignInOutcome> {
    const { firstFactor, work, admit } = context;
    if (!work) await this.assertAdmission(user.id, response);
    // feature:totp:start
    let policyVersion: number | undefined;
    if (work) {
      const application = await this.applications.resolve(response.req);
      this.applications.assertEnabled(application);
      policyVersion = await this.sessionService.assertAdmissionIn(
        work,
        user.id,
        {
          clientId: application.clientId,
          admit,
        },
      );
    }
    if (this.owesSecondFactor(user)) {
      if (!firstFactor) {
        throw new AppException(
          ErrorCode.SESSION_INVALID,
          'Verified first-factor evidence is required',
          HttpStatus.UNAUTHORIZED,
        );
      }
      if (work)
        await this.challengeService.issueIn(work, {
          userId: user.id,
          response,
          firstFactor,
          ...(admit && policyVersion !== undefined ? { policyVersion } : {}),
        });
      else await this.challengeService.issue(user.id, response, firstFactor);
      this.logger.log('Sign-in held for a second factor');
      return { requiresTwoFactor: true };
    }
    // feature:totp:end

    return {
      requiresTwoFactor: false,
      user: await this.issueSessionContext(user, response, {
        evidence: {
          authenticationMethods: firstFactor ? [firstFactor] : [],
          userVerified: false,
        },
        work,
        admit,
      }),
    };
  }

  async assertAdmission(userId: string, response: Response): Promise<void> {
    const application = await this.applications.resolve(response.req);
    this.applications.assertEnabled(application);
    try {
      await this.sessionService.assertAdmission(userId, application.clientId);
    } catch (error) {
      if (error instanceof AppException && this.erasure) {
        throw await this.erasure.refusalFor(userId, error);
      }
      throw error;
    }
  }

  recordCreationRefusal(
    clientId: string,
    method: AccountCreationMethod,
  ): Promise<void> {
    return this.sessionService.recordCreationRefusal(clientId, method);
  }

  /**
   * Creates the session and sets its cookie, with no second factor check. Only
   * for callers that already collected one.
   */
  async issueSession(
    user: SignInAccount,
    response: Response,
    evidence?: BrowserEvidence,
  ): Promise<AuthenticatedUserSummary> {
    return this.issueSessionContext(user, response, {
      evidence,
      work: undefined,
      admit: undefined,
    });
  }

  private async issueSessionContext(
    user: SignInAccount,
    response: Response,
    context: {
      evidence: BrowserEvidence | undefined;
      work: UnitOfWork | undefined;
      admit: BrowserApplicationAdmission | undefined;
    },
  ): Promise<AuthenticatedUserSummary> {
    const { evidence, work } = context;
    const admit = context.admit ?? this.applications.admissionFor(response.req);
    const application = await this.applications.resolve(response.req);
    this.applications.assertEnabled(application);
    const clientId = application.clientId;
    // Build the summary before anything is issued: a failed role read must not
    // leave a live session cookie on a response that then answers an error.
    const summary = toAuthenticatedUser(
      user,
      user.role ? await this.roles.ofRole(user.role) : null,
    );

    const userAgent = response.req.headers['user-agent'] || 'Unknown';
    const ip = response.req.ip || '127.0.0.1';
    const proof = evidence ??
      this.applications.evidenceFor(response.req) ?? {
        authenticationMethods: [],
        userVerified: false,
      };
    const issued = work
      ? await this.sessionService.createSessionIn(work, {
          userId: user.id,
          userAgent,
          ip,
          clientId,
          evidence: proof,
          admit,
        })
      : admit
        ? await this.sessionService.createSessionWithAdmission({
            userId: user.id,
            userAgent,
            ip,
            clientId,
            evidence: proof,
            admit,
          })
        : await this.sessionService.createSession(
            user.id,
            userAgent,
            ip,
            clientId,
            proof,
          );
    const present = () => {
      this.sessionCookieService.set(response, issued.sessionToken, clientId);
      response.setHeader(CSRF_HEADER, issued.csrfToken);
    };
    if (work) work.afterCommit(present);
    else present();
    return summary;
  }

  // feature:totp:start
  /**
   * A deployment that turned two-factor off signs everyone in directly. The
   * verify route is closed there, so a challenge would strand the account.
   */
  private owesSecondFactor(user: SignInAccount): boolean {
    return (
      user.twoFactorEnabled &&
      this.authFeaturesService.isEnabled(AuthFeature.TWO_FACTOR)
    );
  }
  // feature:totp:end
}
