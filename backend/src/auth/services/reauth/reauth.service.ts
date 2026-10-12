import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { HashService } from '../../../common/services/hash.service';
import { SENSITIVE_ACTION_WINDOW_MS } from '../../../session/constants/session-policy';
import { AuthFeature } from '../../enums/auth-feature.enum';
import { AuthFeaturesService } from '../features/auth-features.service';

/** Enough of an account for the password check. */
export interface PasswordHolder {
  /** Absent on an account that signs in without a password. */
  passwordHash?: string;
}

/** Enough of a session for the freshness check. */
export interface SessionAge {
  createdAt: Date;
}

/** What a refused request has to bring next time, in the answer's details. */
export const REAUTH_REQUIREMENT = {
  PASSWORD: 'password',
  RECENT_SIGN_IN: 'recent_sign_in',
  SECOND_FACTOR: 'second_factor',
} as const;

export type ReauthRequirement =
  (typeof REAUTH_REQUIREMENT)[keyof typeof REAUTH_REQUIREMENT];

/** What a caller is told when it offered no proof. */
export interface ReauthMessages {
  passwordRequired: string;
  recentSignInRequired: string;
}

const DEFAULT_MESSAGES: ReauthMessages = {
  passwordRequired: 'Enter your password to continue',
  recentSignInRequired: 'Sign in again to continue',
};

/** The answer to a request that has to prove more before it is served. */
export function reauthRequired(
  message: string,
  required: ReauthRequirement,
): AppException {
  return new AppException(
    ErrorCode.REAUTH_REQUIRED,
    message,
    HttpStatus.UNAUTHORIZED,
    { required },
  );
}

/**
 * Proof that the person changing how the account signs in is the one who
 * signed in, and not someone who sat down at an open browser.
 *
 * A stored password is that proof only while password sign-in is on. With it
 * off nobody can sign in with the password, change it or reset it, so the
 * account is treated as one without a password: a recent sign-in is the proof.
 */
@Injectable()
export class ReauthService {
  protected readonly messages: ReauthMessages = DEFAULT_MESSAGES;

  constructor(
    private readonly hashService: HashService,
    protected readonly features: AuthFeaturesService,
  ) {}

  /**
   * @param user - Account being changed, loaded with its password hash
   * @param password - Password from the request, for accounts that use one
   * @param session - Session the request arrived on
   * @throws AppException REAUTH_REQUIRED when no proof was offered
   * @throws AppException INVALID_CURRENT_PASSWORD when the password is wrong
   */
  async assertReauthenticated(
    user: PasswordHolder,
    password: string | undefined,
    session: SessionAge | undefined,
  ): Promise<void> {
    const hash = this.usablePasswordOf(user);
    if (hash) {
      await this.assertPassword(hash, password);
      return;
    }

    this.assertFreshSession(session);
  }

  /**
   * The password half on its own, for routes that already ask for a code and
   * need nothing more from an account that does not sign in with a password.
   */
  async assertPasswordIfSet(
    user: PasswordHolder,
    password: string | undefined,
  ): Promise<void> {
    const hash = this.usablePasswordOf(user);
    if (!hash) {
      return;
    }

    await this.assertPassword(hash, password);
  }

  /** The stored password, only while the deployment signs people in with one. */
  private usablePasswordOf(user: PasswordHolder): string | undefined {
    return this.features.isEnabled(AuthFeature.PASSWORD)
      ? user.passwordHash
      : undefined;
  }

  private async assertPassword(
    hash: string,
    password: string | undefined,
  ): Promise<void> {
    if (!password) {
      throw reauthRequired(
        this.messages.passwordRequired,
        REAUTH_REQUIREMENT.PASSWORD,
      );
    }

    if (!(await this.hashService.compare(password, hash))) {
      throw new AppException(
        ErrorCode.INVALID_CURRENT_PASSWORD,
        'Current password is incorrect',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Passwordless accounts have nothing to re-enter, so a recent sign-in is the
   * proof. Anything older sends them back through the sign-in they use.
   */
  private assertFreshSession(session: SessionAge | undefined): void {
    const startedAt = session ? new Date(session.createdAt).getTime() : 0;

    if (Date.now() - startedAt <= SENSITIVE_ACTION_WINDOW_MS) {
      return;
    }

    throw reauthRequired(
      this.messages.recentSignInRequired,
      REAUTH_REQUIREMENT.RECENT_SIGN_IN,
    );
  }
}
