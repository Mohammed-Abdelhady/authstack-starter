import { Injectable } from '@nestjs/common';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { PasskeyFacts } from '../../contracts/passkey-facts';
import type { VerifiedPasskeyProof } from '../../contracts/types/passkey-proof';
import { PasskeyStore } from '../stores/passkey.store';
import { relyingPartyScope } from '../utils/relying-party.util';
import { PasskeyConfigService } from './passkey-config.service';

/**
 * Passkey facts per relying party. Passkeys stored before the relying party
 * was recorded count for the web one. The class keeps the name the reserved
 * `contracts/passkey-facts.module.ts` wires.
 */
@Injectable()
export class LegacyPasskeyFacts extends PasskeyFacts {
  constructor(
    private readonly store: PasskeyStore,
    private readonly config: PasskeyConfigService,
  ) {
    super();
  }

  countForRelyingParty(
    unitOfWork: UnitOfWork,
    userId: string,
    rpId: string,
  ): Promise<number> {
    return this.store.countForRelyingParty(
      userId,
      relyingPartyScope(rpId, this.config.rpId),
      unitOfWork,
    );
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
      proof.userVerified,
    );
  }
}
