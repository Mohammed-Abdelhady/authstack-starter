import { Module } from '@nestjs/common';
import { CommonModule } from '../../../common/common.module';
import { ProofModule } from '../../../auth/proof/proof.module';
import { SessionModule } from '../../../session/session.module';
import {
  STAFF_MUTATION_PERSISTENCE_IMPORTS,
  STAFF_MUTATION_PERSISTENCE_PROVIDERS,
} from '../../persistence/staff-mutation-persistence';
import { StaffIdempotency } from './staff-idempotency.service';
import { StaffMutationPolicy } from './staff-mutation-policy';
import { StaffMutationRules } from './staff-mutation-rules';

/** The fresh proof, version and idempotency rules every staff mutation shares. */
@Module({
  imports: [
    CommonModule,
    SessionModule,
    ProofModule,
    ...STAFF_MUTATION_PERSISTENCE_IMPORTS,
  ],
  providers: [
    StaffMutationPolicy,
    StaffIdempotency,
    StaffMutationRules,
    ...STAFF_MUTATION_PERSISTENCE_PROVIDERS,
  ],
  exports: [StaffMutationPolicy, StaffIdempotency, StaffMutationRules],
})
export class StaffMutationsModule {}
