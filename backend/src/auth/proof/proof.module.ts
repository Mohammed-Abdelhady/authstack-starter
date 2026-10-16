import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import {
  PROOF_PERSISTENCE_IMPORTS,
  PROOF_PERSISTENCE_PROVIDERS,
} from './persistence/proof-persistence';

/** Fresh proofs for a signed-in session: a passkey check or a mailed code. */
@Module({
  imports: [CommonModule, ...PROOF_PERSISTENCE_IMPORTS],
  providers: [...PROOF_PERSISTENCE_PROVIDERS],
  exports: [],
})
export class ProofModule {}
