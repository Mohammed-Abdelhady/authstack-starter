import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/decorators/public.decorator';
import { ApiResponse } from '../../common/dto/api-response.dto';
import { THROTTLE_DELETION_RECEIPT } from './constants/deletion-receipt.constants';
import { DeletionReceiptDto } from './dto/account-deletion.dto';
import { DeletionReceiptService } from './services/deletion-receipt.service';

@ApiTags('auth')
@Controller('auth/account-deletion')
export class AccountDeletionReceiptController {
  constructor(private readonly receipts: DeletionReceiptService) {}

  /**
   * For a phone that lost the answer to its delete request, whose session
   * that request ended.
   *
   * @example GET /auth/account-deletion/r1.1760000000000.0f0f...
   */
  @Public()
  @Throttle(THROTTLE_DELETION_RECEIPT)
  @Get(':key')
  @ApiOperation({
    summary: 'Ask whether a deletion was recorded',
    description:
      'Public. Answers `recorded`, `not_recorded` or `unknown` for the receipt ' +
      'key a client sent with DELETE /api/user/account, and never names an ' +
      'account. `not_recorded` is not proof of failure while the request may ' +
      'still be on its way: ask again after a wait. A malformed key is refused ' +
      'with VALIDATION_ERROR.',
  })
  @ApiParam({ name: 'key', description: 'The receipt key the client stored' })
  @ApiOkResponse({ type: DeletionReceiptDto })
  async receipt(
    @Param('key') key: string,
  ): Promise<ApiResponse<DeletionReceiptDto>> {
    return ApiResponse.success({ state: await this.receipts.stateOf(key) });
  }
}
