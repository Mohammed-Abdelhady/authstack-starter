import { Module } from '@nestjs/common';
import { CommonModule } from '../../../common/common.module';
import { ProofModule } from '../../../auth/proof/proof.module';
import {
  STAFF_MUTATION_PERSISTENCE_IMPORTS,
  STAFF_MUTATION_PERSISTENCE_PROVIDERS,
} from '../../persistence/staff-mutation-persistence';
import { StaffIdempotency } from './staff-idempotency.service';
import { StaffMutationPolicy } from './staff-mutation-policy';

/** The fresh proof, version and idempotency rules every staff mutation shares. */
@Module({
  imports: [CommonModule, ProofModule, ...STAFF_MUTATION_PERSISTENCE_IMPORTS],
  providers: [
    StaffMutationPolicy,
    StaffIdempotency,
    ...STAFF_MUTATION_PERSISTENCE_PROVIDERS,
  ],
  exports: [StaffMutationPolicy, StaffIdempotency],
})
export class StaffMutationsModule {}
