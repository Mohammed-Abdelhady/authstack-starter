import { Injectable } from '@nestjs/common';
import {
  PasswordHolder,
  REAUTH_REQUIREMENT,
  ReauthMessages,
  ReauthService,
  reauthRequired,
} from '../../../auth/services/reauth/reauth.service';
import { OWN_EMAIL_MESSAGE } from '../constants/own-email';

/** The password check every other sensitive change uses, in this route's words. */
@Injectable()
export class OwnEmailReauth extends ReauthService {
  protected override readonly messages: ReauthMessages = {
    passwordRequired: OWN_EMAIL_MESSAGE.PASSWORD_REQUIRED,
    recentSignInRequired: OWN_EMAIL_MESSAGE.SIGN_IN_AGAIN,
  };

  /**
   * The password in place of a recent sign-in, for an account that signs in
   * with one.
   *
   * @throws AppException REAUTH_REQUIRED asking for the password when it is
   *   missing, or for a recent sign-in when the account has no usable password
   * @throws AppException INVALID_CURRENT_PASSWORD when it is wrong
   */
  async assertPasswordInstead(
    holder: PasswordHolder,
    password: string | undefined,
  ): Promise<void> {
    if (this.usablePasswordOf(holder) === undefined) {
      throw reauthRequired(
        this.messages.recentSignInRequired,
        REAUTH_REQUIREMENT.RECENT_SIGN_IN,
      );
    }
    await this.assertPasswordIfSet(holder, password);
  }
}
