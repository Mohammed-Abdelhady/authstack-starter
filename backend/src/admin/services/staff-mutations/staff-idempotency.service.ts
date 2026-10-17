import { assertReplayedPassword } from '../users/admin-user-replay';
import { HttpStatus, Injectable } from '@nestjs/common';
import { IDEMPOTENCY_KEY_LIFETIME_MS } from '../../../common/constants/idempotency';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { HashService } from '../../../common/services/hash.service';
import { Clock } from '../../../common/services/clock';
import { IDEMPOTENCY_CLAIM } from '../../constants/staff-operations';
import { StaffIdempotencyStore } from '../../stores/staff-idempotency.store';
import type {
  IdempotencyScope,
  StaffOperation,
  StaffCreateResult,
} from '../../types/staff-idempotency';
import {
  idempotencyKeyReused,
  requestFingerprint,
} from '../../utils/request-fingerprint';

/** One staff create, as its key is scoped. */
export interface IdempotentCreate {
  readonly key: string | undefined;
  readonly actorId: string;
  readonly clientId: string;
  readonly operation: StaffOperation;
  readonly body: unknown;
  readonly password?: string;
  readonly secretHash?: string;
}

export type IdempotentStart =
  | { readonly replayed: false }
  | {
      readonly replayed: true;
      readonly resourceId: string;
      readonly result: StaffCreateResult;
    };

/**
 * Both calls run inside the create's unit of work: `start` before any write,
 * `finish` after the insert. A create sent without a key runs as before.
 */
@Injectable()
export class StaffIdempotency {
  constructor(
    private readonly store: StaffIdempotencyStore,
    private readonly clock: Clock,
    private readonly hashes: HashService,
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
      secretHash: create.secretHash,
      now,
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_KEY_LIFETIME_MS),
    });
    if (claim.status === IDEMPOTENCY_CLAIM.CLAIMED) return { replayed: false };
    if (claim.requestHash !== requestHash) throw idempotencyKeyReused();
    if (create.password !== undefined)
      await assertReplayedPassword(
        this.hashes,
        claim.secretHash,
        create.password,
      );
    if (claim.resourceId === null || claim.result === null) {
      throw conflict(
        'The first request with this idempotency key has not finished',
      );
    }
    return {
      replayed: true,
      resourceId: claim.resourceId,
      result: restoreResult(claim.result),
    };
  }

  async finish(
    unitOfWork: UnitOfWork,
    create: IdempotentCreate,
    resourceId: string,
    result?: StaffCreateResult,
  ): Promise<void> {
    const scope = scopeOf(create);
    if (scope) await this.store.complete(unitOfWork, scope, resourceId, result);
  }
}

function conflict(message: string): AppException {
  return new AppException(ErrorCode.CONFLICT, message, HttpStatus.CONFLICT);
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

function restoredDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function restoreResult(result: StaffCreateResult): StaffCreateResult {
  if ('account' in result)
    return {
      ...result,
      account: {
        ...result.account,
        createdAt:
          result.account.createdAt === undefined
            ? undefined
            : restoredDate(result.account.createdAt),
        updatedAt:
          result.account.updatedAt === undefined
            ? undefined
            : restoredDate(result.account.updatedAt),
      },
    };
  if ('role' in result)
    return {
      role: {
        ...result.role,
        createdAt: restoredDate(result.role.createdAt),
        updatedAt: restoredDate(result.role.updatedAt),
      },
    };
  // feature:invitations:start
  if ('invitation' in result)
    return {
      invitation: {
        ...result.invitation,
        name: result.invitation.name ?? undefined,
        audience: result.invitation.audience ?? undefined,
        invitedBy: result.invitation.invitedBy ?? undefined,
        createdAt: restoredDate(result.invitation.createdAt),
        expiresAt: restoredDate(result.invitation.expiresAt),
        acceptedAt:
          result.invitation.acceptedAt === undefined ||
          result.invitation.acceptedAt === null
            ? undefined
            : restoredDate(result.invitation.acceptedAt),
        revokedAt:
          result.invitation.revokedAt === undefined ||
          result.invitation.revokedAt === null
            ? undefined
            : restoredDate(result.invitation.revokedAt),
      },
    };
  // feature:invitations:end
  throw idempotencyKeyReused();
}
