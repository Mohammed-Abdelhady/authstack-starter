import { STAFF_OPERATION } from '../../../src/admin/constants/staff-operations';
import { IdempotencyClaimInput } from '../../../src/admin/types/staff-idempotency';
import { StaffIdempotencyHarness } from './staff-idempotency-harness';

export const KEY_LIFETIME_MS = 60_000;
export const FIRST_HASH = 'first-request-hash';
export const SECOND_HASH = 'second-request-hash';
export const RESOURCE_ID = 'created-account';

export function claimInput(
  h: StaffIdempotencyHarness,
  actorId = 'first-actor',
  requestHash = FIRST_HASH,
): IdempotencyClaimInput {
  return {
    scope: {
      actorId,
      clientId: 'staff-console',
      operation: STAFF_OPERATION.ACCOUNT_CREATE,
      key: 'create-key',
    },
    requestHash,
    now: h.clock.now(),
    expiresAt: new Date(h.clock.now().getTime() + KEY_LIFETIME_MS),
  };
}
