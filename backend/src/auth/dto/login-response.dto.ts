import { ApiResponse } from '../../common/dto/api-response.dto';
import { AuthenticatedUserSummary } from '../interfaces/authenticated-user.interface';

/**
 * Body of every sign-in route that answers with JSON. When a second factor is
 * owed there is no session yet, so `user` is null and the client sends the
 * code to POST /auth/2fa/verify.
 */
export class LoginResponseDto {
  requiresTwoFactor!: boolean;

  user!: AuthenticatedUserSummary | null;

  static success(
    user: AuthenticatedUserSummary,
  ): ApiResponse<LoginResponseDto> {
    const dto = new LoginResponseDto();
    dto.requiresTwoFactor = false;
    dto.user = user;
    return ApiResponse.success(dto, 'Login successful');
  }

  static twoFactorRequired(): ApiResponse<LoginResponseDto> {
    const dto = new LoginResponseDto();
    dto.requiresTwoFactor = true;
    dto.user = null;
    return ApiResponse.success(
      dto,
      'Enter the code from your authenticator app',
    );
  }
}
