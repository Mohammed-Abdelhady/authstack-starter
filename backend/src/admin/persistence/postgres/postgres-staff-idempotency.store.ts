import { Injectable } from '@nestjs/common';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { IDEMPOTENCY_CLAIM } from '../../constants/staff-operations';
import { StaffIdempotencyStore } from '../../stores/staff-idempotency.store';
import {
  IdempotencyClaim,
  IdempotencyClaimInput,
  IdempotencyScope,
} from '../../types/staff-idempotency';

@Injectable()
export class PostgresStaffIdempotencyStore extends StaffIdempotencyStore {
  async claim(
    uow: UnitOfWork,
    input: IdempotencyClaimInput,
  ): Promise<IdempotencyClaim> {
    const transaction = postgresTransactionOf(uow);
    const values = {
      ...scopeColumns(input.scope),
      request_hash: input.requestHash,
      resource_id: null,
      created_at: input.now,
      expires_at: input.expiresAt,
    };
    const claimed = await transaction
      .insertInto('staff_idempotency_keys')
      .values(values)
      .onConflict((conflict) =>
        conflict
          .columns(['actor_id', 'client_id', 'operation', 'idempotency_key'])
          .doUpdateSet(values)
          .where('staff_idempotency_keys.expires_at', '<=', input.now),
      )
      .returning('actor_id')
      .executeTakeFirst();
    if (claimed) return { status: IDEMPOTENCY_CLAIM.CLAIMED };
    const existing = await transaction
      .selectFrom('staff_idempotency_keys')
      .select(['request_hash', 'resource_id'])
      .where('actor_id', '=', input.scope.actorId)
      .where('client_id', '=', input.scope.clientId)
      .where('operation', '=', input.scope.operation)
      .where('idempotency_key', '=', input.scope.key)
      .executeTakeFirstOrThrow();
    return {
      status: IDEMPOTENCY_CLAIM.EXISTING,
      requestHash: existing.request_hash,
      resourceId: existing.resource_id,
    };
  }

  async complete(
    uow: UnitOfWork,
    scope: IdempotencyScope,
    resourceId: string,
  ): Promise<void> {
    await postgresTransactionOf(uow)
      .updateTable('staff_idempotency_keys')
      .set({ resource_id: resourceId })
      .where('actor_id', '=', scope.actorId)
      .where('client_id', '=', scope.clientId)
      .where('operation', '=', scope.operation)
      .where('idempotency_key', '=', scope.key)
      .execute();
  }
}

function scopeColumns(scope: IdempotencyScope) {
  return {
    actor_id: scope.actorId,
    client_id: scope.clientId,
    operation: scope.operation,
    idempotency_key: scope.key,
  };
}
