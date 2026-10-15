import { Injectable } from '@nestjs/common';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { PasskeyFacts } from '../../contracts/passkey-facts';
import type { VerifiedPasskeyProof } from '../../contracts/types/passkey-proof';
import { PasskeyStore } from '../stores/passkey.store';
import { PasskeyConfigService } from './passkey-config.service';

@Injectable()
export class LegacyPasskeyFacts extends PasskeyFacts {
  constructor(
    private readonly store: PasskeyStore,
    private readonly config: PasskeyConfigService,
  ) {
    super();
  }

  async countForRelyingParty(
    unitOfWork: UnitOfWork,
    userId: string,
    rpId: string,
  ): Promise<number> {
    if (rpId !== this.config.rpId) return 0;
    return (await this.store.listDescriptors(userId, unitOfWork)).length;
  }

  userWasVerified(
    proof: VerifiedPasskeyProof | undefined,
    userId: string,
    rpId: string,
  ): boolean {
    return Boolean(
      proof &&
      proof.credentialId &&
      proof.userId === userId &&
      proof.rpId === rpId &&
      rpId === this.config.rpId &&
      proof.userVerified,
    );
  }
}
