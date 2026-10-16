import { HttpStatus, Injectable } from '@nestjs/common';
import { IDEMPOTENCY_KEY_LIFETIME_MS } from '../../../common/constants/idempotency';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { Clock } from '../../../common/services/clock';
import { IDEMPOTENCY_CLAIM } from '../../constants/staff-operations';
import { StaffIdempotencyStore } from '../../stores/staff-idempotency.store';
import type {
  IdempotencyScope,
  StaffOperation,
} from '../../types/staff-idempotency';
import { requestFingerprint } from '../../utils/request-fingerprint';

/** One staff create, as its key is scoped. */
export interface IdempotentCreate {
  readonly key: string | undefined;
  readonly actorId: string;
  readonly clientId: string;
  readonly operation: StaffOperation;
  readonly body: unknown;
}

export type IdempotentStart =
  | { readonly replayed: false }
  | { readonly replayed: true; readonly resourceId: string };

/**
 * Both calls run inside the create's unit of work: `start` before any write,
 * `finish` after the insert. A create sent without a key runs as before.
 */
@Injectable()
export class StaffIdempotency {
  constructor(
    private readonly store: StaffIdempotencyStore,
    private readonly clock: Clock,
  ) {}

  /**
   * @throws AppException CONFLICT when the key was used for another request,
   * or its first create has not finished
   */
  async start(
    unitOfWork: UnitOfWork,
    create: IdempotentCreate,
  ): Promise<IdempotentStart> {
    const scope = scopeOf(create);
    if (!scope) return { replayed: false };
    const now = this.clock.now();
    const requestHash = requestFingerprint(create.operation, create.body);
    const claim = await this.store.claim(unitOfWork, {
      scope,
      requestHash,
      now,
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_KEY_LIFETIME_MS),
    });
    if (claim.status === IDEMPOTENCY_CLAIM.CLAIMED) return { replayed: false };
    if (claim.requestHash !== requestHash) throw idempotencyKeyReused();
    if (claim.resourceId === null) {
      throw conflict(
        'The first request with this idempotency key has not finished',
      );
    }
    return { replayed: true, resourceId: claim.resourceId };
  }

  async finish(
    unitOfWork: UnitOfWork,
    create: IdempotentCreate,
    resourceId: string,
  ): Promise<void> {
    const scope = scopeOf(create);
    if (scope) await this.store.complete(unitOfWork, scope, resourceId);
  }
}

function conflict(message: string): AppException {
  return new AppException(ErrorCode.CONFLICT, message, HttpStatus.CONFLICT);
}

/** The refusal for a key sent again with another request. */
export function idempotencyKeyReused(): AppException {
  return conflict('This idempotency key was used for a different request');
}

function scopeOf(create: IdempotentCreate): IdempotencyScope | undefined {
  if (create.key === undefined) return undefined;
  return {
    actorId: create.actorId,
    clientId: create.clientId,
    operation: create.operation,
    key: create.key,
  };
}
