import type { Logger } from '@nestjs/common';
import type { ApiResponse } from '../../../common/dto/api-response.dto';
import type { ActivationAccounts } from '../../pending-codes/activation-accounts';
import { ActivateResponseDto } from '../../dto/activate-response.dto';
import { logUnknownCommit } from '../../utils/unknown-commit.util';
import { asAuthorityUnavailable } from '../../../session/utils/authority/authority-unavailable';

/** Resolve only this attempt's generated id after an uncertain activation. */
export async function finishUnknownActivation(
  accounts: ActivationAccounts,
  logger: Logger,
  accountId: string,
  error: unknown,
): Promise<ApiResponse<ActivateResponseDto>> {
  let committed = false;
  try {
    committed = await accounts.isStored(accountId);
  } catch {
    logUnknownCommit(logger, 'Activation', error);
    asAuthorityUnavailable(error);
  }
  if (committed) {
    logUnknownCommit(logger, 'Activation', error);
    return ActivateResponseDto.signInRequired();
  }
  asAuthorityUnavailable(error);
}
