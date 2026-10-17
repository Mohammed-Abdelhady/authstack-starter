import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequestWithUser } from '../../auth/guards/auth.guard';
import { ApiResponse } from '../../common/dto/api-response.dto';
import { SESSION_SWAGGER_AUTH_NAME } from '../../common/constants/session';
import {
  THROTTLE_ACTIVATE,
  THROTTLE_FORGOT_PASSWORD,
} from '../../common/constants/throttle';
import { OWN_EMAIL_MESSAGE } from './constants/own-email';
import {
  ConfirmOwnEmailChangeDto,
  OwnEmailDto,
  OwnEmailProofDto,
  RequestOwnEmailChangeDto,
} from './dto/own-email.dto';
import { OwnEmailConfirmationService } from './services/own-email-confirmation.service';
import { OwnEmailRequestService } from './services/own-email-request.service';
import { ownEmailCaller } from './utils/own-email-caller';

/** The signed-in account holder moves their own account to another address. */
@ApiTags('user')
@ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
@Controller('user/email')
export class OwnEmailController {
  constructor(
    private readonly requests: OwnEmailRequestService,
    private readonly confirmations: OwnEmailConfirmationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Read the email address and the one waiting to be confirmed',
  })
  async read(
    @CurrentUser('id') userId: string,
  ): Promise<ApiResponse<OwnEmailDto>> {
    return ApiResponse.success(await this.requests.read(userId));
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_FORGOT_PASSWORD)
  @ApiOperation({
    summary: 'Ask to move the account to another address',
    description:
      'Needs a recent actual sign-in, a session-bound fresh proof, or the account ' +
      'password for an account that has one. A required-passkey application ' +
      'needs its relying-party user-verified proof. A code goes to the new address and a notice to ' +
      'the current one. The answer is the same for an address that is free ' +
      'and for one that is taken; a taken one never gets a code.',
  })
  @ApiBody({ type: RequestOwnEmailChangeDto })
  async request(
    @Req() request: RequestWithUser,
    @Body() dto: RequestOwnEmailChangeDto,
  ): Promise<ApiResponse<OwnEmailDto>> {
    return ApiResponse.success(
      await this.requests.request(
        ownEmailCaller(request),
        dto.email,
        dto.password,
      ),
      OWN_EMAIL_MESSAGE.REQUESTED,
    );
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle(THROTTLE_ACTIVATE)
  @ApiOperation({
    summary: 'Confirm the new address with the mailed code',
    description:
      'Moves the account. This session stays signed in and every other one ' +
      'ends. The previous address is told.',
  })
  @ApiBody({ type: ConfirmOwnEmailChangeDto })
  async confirm(
    @Req() request: RequestWithUser,
    @Body() dto: ConfirmOwnEmailChangeDto,
  ): Promise<ApiResponse<OwnEmailDto>> {
    return ApiResponse.success(
      await this.confirmations.confirm(ownEmailCaller(request), dto.code),
      OWN_EMAIL_MESSAGE.CONFIRMED,
    );
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel the pending change',
    description:
      'Frees the address asked for. Its code stops working. It needs the ' +
      'proof a request needs, whoever started the change.',
  })
  @ApiBody({ type: OwnEmailProofDto, required: false })
  async cancel(
    @Req() request: RequestWithUser,
    @Body() dto: OwnEmailProofDto,
  ): Promise<ApiResponse<OwnEmailDto>> {
    return ApiResponse.success(
      await this.requests.cancel(ownEmailCaller(request), dto.password),
      OWN_EMAIL_MESSAGE.CANCELLED,
    );
  }
}
