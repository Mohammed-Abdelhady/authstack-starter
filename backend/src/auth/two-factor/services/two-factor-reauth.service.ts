import { HttpStatus, Injectable } from '@nestjs/common';
import { HashService } from '../../../common/services/hash.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AuthFeature } from '../../enums/auth-feature.enum';
import { AuthFeaturesService } from '../../services/features/auth-features.service';
import { TWO_FACTOR_FRESH_SESSION_MS } from '../constants/two-factor.constants';

/** Enough of an account for the password check. */
export interface PasswordHolder {
  /** Absent on an account that signs in without a password. */
  passwordHash?: string;
}

/** Enough of a session for the freshness check. */
export interface SessionAge {
  createdAt: Date;
}

/**
 * Proof that the person changing the second factor is the one who signed in,
 * and not someone who sat down at an open browser.
 *
 * A stored password is that proof only while password sign-in is on. With it
 * off nobody can sign in with the password, change it or reset it, so the
 * account is treated as one without a password: a recent sign-in starts
 * setup, and a current code turns the factor off.
 */
@Injectable()
export class TwoFactorReauthService {
  constructor(
    private readonly hashService: HashService,
    private readonly features: AuthFeaturesService,
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
      throw new AppException(
        ErrorCode.REAUTH_REQUIRED,
        'Enter your password to change two-factor authentication',
        HttpStatus.UNAUTHORIZED,
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

    if (Date.now() - startedAt <= TWO_FACTOR_FRESH_SESSION_MS) {
      return;
    }

    throw new AppException(
      ErrorCode.REAUTH_REQUIRED,
      'Sign in again to change two-factor authentication',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
