import { Injectable } from '@nestjs/common';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { PasskeyFacts } from '../passkey-facts';
import type { VerifiedPasskeyProof } from '../types/passkey-proof';

@Injectable()
export class EmptyPasskeyFacts extends PasskeyFacts {
  countForRelyingParty(
    _unitOfWork: UnitOfWork,
    _userId: string,
    _rpId: string,
  ): Promise<number> {
    return Promise.resolve(0);
  }

  userWasVerified(
    _proof: VerifiedPasskeyProof | undefined,
    _userId: string,
    _rpId: string,
  ): boolean {
    return false;
  }
}
