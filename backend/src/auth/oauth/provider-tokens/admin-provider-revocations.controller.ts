import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SESSION_SWAGGER_AUTH_NAME } from '../../../common/constants/session';
import { USER_PERMISSIONS } from '../../../common/constants/permissions';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { Clock } from '../../../common/services/clock';
import { StaffGuard } from '../../guards/staff.guard';
import { REVOCATION_OUTCOME } from './constants/provider-tokens.constants';
import { ProviderTokenStore } from './stores/provider-token.store';

@ApiTags('admin')
@ApiCookieAuth(SESSION_SWAGGER_AUTH_NAME)
@Controller('admin/erasure-jobs/revocations')
@UseGuards(StaffGuard, PermissionGuard)
export class AdminProviderRevocationsController {
  constructor(
    private readonly store: ProviderTokenStore,
    private readonly clock: Clock,
  ) {}

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(USER_PERMISSIONS.DELETE_ALL)
  @ApiOperation({
    summary: 'Close a provider revocation',
    description:
      'Ends a pending revocation without calling the provider, for a person ' +
      'who revoked the grant another way. Its token is removed. Refused with ' +
      'NOT_FOUND when no pending job has the id.',
  })
  async close(@Param('id') id: string): Promise<ApiResponse<null>> {
    const closed = await this.store.settle(
      id,
      REVOCATION_OUTCOME.CLOSED_BY_STAFF,
      this.clock.now(),
    );
    if (!closed) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        'No pending revocation has this id',
        HttpStatus.NOT_FOUND,
      );
    }
    return ApiResponse.success(null, 'Revocation closed');
  }
}
