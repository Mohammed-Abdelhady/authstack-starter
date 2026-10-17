import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { SessionModule } from '../../session/session.module';
import { AuthContractsModule } from '../contracts/auth-contracts.module';
import { FreshProofGate } from './fresh-proof-gate';
import { StaffFreshProofGate } from './staff-fresh-proof-gate';
import { SessionProofStore } from './stores/session-proof.store';
import {
  PROOF_PERSISTENCE_IMPORTS,
  PROOF_PERSISTENCE_PROVIDERS,
} from './persistence/proof-persistence';

@Module({
  imports: [
    CommonModule,
    SessionModule,
    AuthContractsModule,
    ...PROOF_PERSISTENCE_IMPORTS,
  ],
  providers: [
    ...PROOF_PERSISTENCE_PROVIDERS,
    { provide: FreshProofGate, useClass: StaffFreshProofGate },
  ],
  exports: [FreshProofGate, SessionProofStore],
})
export class ProofGateModule {}
