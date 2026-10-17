import { Injectable } from '@nestjs/common';
import { FRESH_PROOF_REQUIREMENT } from '../../auth/contracts/constants/fresh-proof';
import { FreshProofGate } from '../../auth/proof/fresh-proof-gate';
import type { ActingSession } from '../../auth/proof/types/acting-session';
import type { ApiResponse } from '../../common/dto/api-response.dto';
import type { AccountDeletionResultDto } from '../erasure/dto/account-deletion.dto';
import { UserProfileService } from './user-profile.service';

@Injectable()
export class OwnAccountDeletionService {
  constructor(
    private readonly profiles: UserProfileService,
    private readonly proofs: FreshProofGate,
  ) {}

  deactivate(
    session: ActingSession,
    receiptKey?: string,
  ): Promise<ApiResponse<AccountDeletionResultDto>> {
    return this.profiles.deactivateAccount(
      session.userId,
      receiptKey,
      (unitOfWork) =>
        this.proofs.assertFresh(
          unitOfWork,
          session,
          FRESH_PROOF_REQUIREMENT.ACT,
        ),
    );
  }
}
