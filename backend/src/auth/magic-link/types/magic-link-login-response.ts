import type { LoginResponseDto } from '../../dto/login-response.dto';

export type MagicLinkLoginResponseData = LoginResponseDto & {
  redirect?: string;
  /** True when the link is unspent and a person has to confirm it. */
  requiresConfirmation?: true;
  /** The address behind the link, masked for the confirmation screen. */
  email?: string;
};
