import { Injectable } from '@nestjs/common';
import { EventRecorder } from '../../../auth/contracts/event-recorder';
import { StaffIdempotency } from './staff-idempotency.service';
import { StaffMutationPolicy } from './staff-mutation-policy';

/** What every staff mutation applies: proof and version rules, idempotent creates, the log. */
@Injectable()
export class StaffMutationRules {
  constructor(
    readonly policy: StaffMutationPolicy,
    readonly idempotency: StaffIdempotency,
    readonly events: EventRecorder,
  ) {}
}
