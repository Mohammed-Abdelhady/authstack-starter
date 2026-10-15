import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { THROTTLE_PASSKEY_REGISTER } from '../../../common/constants/throttle';
import { CurrentUser } from '../../decorators/current-user.decorator';
import { RequiresFeature } from '../../decorators/requires-feature.decorator';
import { AuthFeature } from '../../enums/auth-feature.enum';
import { RequestWithUser } from '../../guards/auth.guard';
import { PasskeySummaryDto } from '../dto/passkey-summary.dto';
import { VerifyPasskeyRegistrationDto } from '../dto/verify-passkey-registration.dto';
import { PasskeyCreationOptions } from '../services/webauthn.adapter';
import { NativePasskeyRegistrationService } from './native-passkey-registration.service';

/**
 * Adding a passkey from a signed-in mobile app, on its access token. Listing,
 * renaming and removing take the same token on the routes the browser uses.
 */
@ApiTags('auth')
@Controller('auth/native/passkeys')
@RequiresFeature(AuthFeature.PASSKEYS)
export class NativePasskeysController {
  constructor(
    private readonly registration: NativePasskeyRegistrationService,
  ) {}

  /**
   * Start registering a passkey from the app
   * POST /api/auth/native/passkeys/register/options
   */
  @Throttle(THROTTLE_PASSKEY_REGISTER)
  @Post('register/options')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Options for registering a passkey from a mobile app',
    description:
      'Bearer access token only. Returns the options for the system passkey ' +
      'prompt, for the relying party of the application the token belongs ' +
      'to. Passkeys the account has for that relying party are excluded. A ' +
      'sign-in older than five minutes answers 401 REAUTH_REQUIRED with ' +
      'details.required recent_sign_in. An application without a native ' +
      'relying party answers 404 FEATURE_DISABLED.',
  })
  async registerOptions(
    @CurrentUser('id') userId: string,
    @Req() request: RequestWithUser,
  ): Promise<ApiResponse<PasskeyCreationOptions>> {
    return this.registration.createOptions(userId, request.session);
  }

  /**
   * Finish registering a passkey from the app
   * POST /api/auth/native/passkeys/register/verify
   */
  @Post('register/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Store a passkey registered from a mobile app',
    description:
      'Bearer access token only. The challenge is spent once, and only by ' +
      'the session it was issued to, within five minutes. The attestation ' +
      'must come from one of the application origins and carry user ' +
      'verification.',
  })
  @ApiBody({ type: VerifyPasskeyRegistrationDto })
  async registerVerify(
    @CurrentUser('id') userId: string,
    @Body() dto: VerifyPasskeyRegistrationDto,
    @Req() request: RequestWithUser,
  ): Promise<ApiResponse<PasskeySummaryDto>> {
    return this.registration.verify(userId, request.session, dto);
  }
}
