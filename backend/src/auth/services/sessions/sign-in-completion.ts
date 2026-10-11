import {
  Injectable,
  Logger, // feature:totp
} from '@nestjs/common';
import { Response } from 'express';
import { RolePermissions } from '../../../role/stores/role-permissions';
import { Sessions } from './sessions';
import { CSRF_HEADER } from '../../../session/constants/browser-proof';
import { SessionCookieService } from './session-cookie.service';
import { FirstFactor } from './first-factor'; // feature:totp
import { AuthFeaturesService } from '../features/auth-features.service'; // feature:totp
import { AuthFeature } from '../../enums/auth-feature.enum'; // feature:totp
import {
  AuthenticatedUserSummary,
  SignInAccount,
  toAuthenticatedUser,
} from '../../utils/authenticated-user.util';
import { TwoFactorChallengeService } from '../../two-factor/services/two-factor-challenge.service'; // feature:totp

/**
 * Either the sign-in finished and the caller has a session, or a second factor
 * is owed and the challenge cookie is already set.
 */
export type SignInOutcome =
  | { requiresTwoFactor: true }
  | { requiresTwoFactor: false; user: AuthenticatedUserSummary };

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
  ) {}

  /**
   * Finishes a sign-in for a user who cleared their first factor. An account
   * with a confirmed second factor gets a challenge cookie instead of a
   * session.
   */
  async completeSignIn(
    user: SignInAccount,
    response: Response,
    firstFactor: FirstFactor, // feature:totp
  ): Promise<SignInOutcome> {
    // feature:totp:start
    if (this.owesSecondFactor(user)) {
      await this.challengeService.issue(user.id, response, firstFactor);
      this.logger.log('Sign-in held for a second factor');
      return { requiresTwoFactor: true };
    }
    // feature:totp:end

    return {
      requiresTwoFactor: false,
      user: await this.issueSession(user, response),
    };
  }

  /**
   * Creates the session and sets its cookie, with no second factor check. Only
   * for callers that already collected one.
   */
  async issueSession(
    user: SignInAccount,
    response: Response,
  ): Promise<AuthenticatedUserSummary> {
    // Build the summary before anything is issued: a failed role read must not
    // leave a live session cookie on a response that then answers an error.
    const summary = toAuthenticatedUser(
      user,
      user.role ? await this.roles.ofRole(user.role) : null,
    );

    const userAgent = response.req.headers['user-agent'] || 'Unknown';
    const ip = response.req.ip || '127.0.0.1';
    const issued = await this.sessionService.createSession(
      user.id,
      userAgent,
      ip,
    );

    this.sessionCookieService.set(response, issued.sessionToken);
    response.setHeader(CSRF_HEADER, issued.csrfToken);
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
