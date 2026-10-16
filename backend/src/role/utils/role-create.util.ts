import type { AudiencePolicy } from '../../session/applications/audience-policy';
import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { ROLE_PERMISSIONS } from '../../common/constants/permissions';
import { UniqueConflictError } from '../../common/persistence/persistence-errors';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../common/persistence/unit-of-work';
import { CUSTOM_ROLE_LEVEL } from '../../common/utils/role-hierarchy';
import { asAuthorityUnavailable } from '../../session/utils/authority/authority-unavailable';
import { CreateRoleDto } from '../dto/create-role.dto';
import { RoleChangeStore } from '../stores/role-change.store';
import { RoleFieldsRejectedError, StoredRole } from '../stores/role-records';
import {
  assertCanGrant,
  assertFreshRolePermission,
  assertLevelBelowActor,
} from './role-actor.util';
import { isStoreOutage } from './role-failure.util';
import { dedupePermissions } from './role.util';
import type { StaffMutationRules } from '../../admin/services/staff-mutations/staff-mutation-rules';
import type { ActingSession } from '../../auth/proof/types/acting-session';
import { STAFF_OPERATION } from '../../admin/constants/staff-operations';
import { SECURITY_EVENT_ACTION } from '../../session/constants/security-event-action';

/** The session and idempotency key a staff create arrived with. */
export interface RoleCreateRequest {
  session?: ActingSession;
  key?: string;
}

interface RoleCreation {
  runner: UnitOfWorkRunner;
  store: RoleChangeStore;
  audiencePolicy?: AudiencePolicy;
  rules: StaffMutationRules;
  request: RoleCreateRequest;
}

/**
 * Store a new custom role. The actor is read inside the unit of work, so a
 * permission it lost after the request was admitted cannot be handed out.
 */
export function createRoleWithinCeiling(
  { runner, store, audiencePolicy, rules, request }: RoleCreation,
  dto: CreateRoleDto,
  slug: string,
  actorId: string,
): Promise<StoredRole> {
  rules.policy.assertKey(request.key);
  const create = {
    key: request.key,
    actorId,
    clientId: request.session?.clientId ?? '',
    operation: STAFF_OPERATION.ROLE_CREATE,
    body: dto,
  };
  return runner.runForAuthority(actorId, async (unitOfWork) => {
    await rules.policy.assertRouteProof(unitOfWork, request.session);
    const actor = await assertFreshRolePermission(
      store,
      unitOfWork,
      actorId,
      ROLE_PERMISSIONS.CREATE_ALL,
    );
    const start = await rules.idempotency.start(unitOfWork, create);
    if (start.replayed)
      return replayedRole(store, unitOfWork, start.resourceId);
    if (audiencePolicy?.enabled()) {
      if (dto.audience === undefined) {
        throw new AppException(
          ErrorCode.VALIDATION_ERROR,
          'A role audience is required while audience policy is enabled',
          HttpStatus.BAD_REQUEST,
        );
      }
      audiencePolicy.assertDirectPermissions(dto.audience, dto.permissions);
    }
    assertCanGrant(actor, dto.permissions);
    const level = dto.level ?? CUSTOM_ROLE_LEVEL;
    assertLevelBelowActor(actor, level);
    const role = await store.insertCustomRole(unitOfWork, {
      name: dto.name,
      slug,
      description: dto.description,
      audience: dto.audience,
      level,
      permissions: dedupePermissions(dto.permissions),
    });
    await rules.idempotency.finish(unitOfWork, create, role.id);
    await rules.events.record(unitOfWork, {
      action: SECURITY_EVENT_ACTION.ROLE_CREATED,
      actorId,
      clientId: request.session?.clientId,
      details: { roleId: role.id, slug: role.slug },
    });
    return role;
  });
}

/** The role a replayed create made, read again; nothing is written. */
async function replayedRole(
  store: RoleChangeStore,
  unitOfWork: UnitOfWork,
  roleId: string,
): Promise<StoredRole> {
  const role = await store.readRole(unitOfWork, roleId);
  if (!role) {
    throw new AppException(
      ErrorCode.CONFLICT,
      'The role this request created no longer exists',
      HttpStatus.CONFLICT,
    );
  }
  return role;
}

/** Turn a failed role write into the answer the role routes give for it. */
export function rethrowRoleWriteError(
  error: unknown,
  requestedSlug?: string,
): never {
  if (error instanceof UniqueConflictError) {
    throw new AppException(
      ErrorCode.ROLE_NAME_TAKEN,
      `Role with slug "${requestedSlug ?? 'requested'}" already exists`,
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof RoleFieldsRejectedError) {
    throw new AppException(
      ErrorCode.VALIDATION_ERROR,
      error.message,
      HttpStatus.BAD_REQUEST,
    );
  }
  if (!isStoreOutage(error)) {
    throw error;
  }
  asAuthorityUnavailable(error);
}
