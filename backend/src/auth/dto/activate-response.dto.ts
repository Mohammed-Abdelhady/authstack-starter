import { ApiResponse } from '../../common/dto/api-response.dto';
import { AuthenticatedUserSummary } from '../interfaces/authenticated-user.interface';

/**
 * Body of activation. Like every sign-in route, an account that owes a second
 * factor gets no session yet: `user` is null and the code goes to
 * POST /auth/2fa/verify. `mustSignIn` is true when the account was created but
 * the session could not be issued, so the client sends the user to sign in.
 */
export class ActivateResponseDto {
  requiresTwoFactor!: boolean;

  mustSignIn!: boolean;

  user!: AuthenticatedUserSummary | null;

  static success(
    user: AuthenticatedUserSummary,
  ): ApiResponse<ActivateResponseDto> {
    const dto = new ActivateResponseDto();
    dto.requiresTwoFactor = false;
    dto.mustSignIn = false;
    dto.user = user;
    return ApiResponse.success(dto, 'Account activated successfully');
  }

  static twoFactorRequired(): ApiResponse<ActivateResponseDto> {
    const dto = new ActivateResponseDto();
    dto.requiresTwoFactor = true;
    dto.mustSignIn = false;
    dto.user = null;
    return ApiResponse.success(
      dto,
      'Enter the code from your authenticator app',
    );
  }

  /** The account is committed, but no session was issued. */
  static signInRequired(): ApiResponse<ActivateResponseDto> {
    const dto = new ActivateResponseDto();
    dto.requiresTwoFactor = false;
    dto.mustSignIn = true;
    dto.user = null;
    return ApiResponse.success(dto, 'Account activated. Sign in to continue.');
  }
}
