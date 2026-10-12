import { Injectable } from '@nestjs/common';
import {
  ReauthMessages,
  ReauthService,
} from '../../services/reauth/reauth.service';

export type {
  PasswordHolder,
  SessionAge,
} from '../../services/reauth/reauth.service';

/**
 * The shared proof, asked of whoever changes the second factor: the password
 * starts setup and turns the factor off, and an account without one starts
 * setup on a recent sign-in and turns the factor off with a current code.
 */
@Injectable()
export class TwoFactorReauthService extends ReauthService {
  protected override readonly messages: ReauthMessages = {
    passwordRequired: 'Enter your password to change two-factor authentication',
    recentSignInRequired: 'Sign in again to change two-factor authentication',
  };
}
