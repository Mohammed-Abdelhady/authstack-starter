import { AudiencePolicy } from '../../../session/applications/audience-policy';
import { randomUUID } from 'crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import { asAuthorityUnavailable } from '../../../session/utils/authority/authority-unavailable';
import { ROLE_PENDING_SWEEP_LIMIT } from '../../../common/constants/roles';
import { ROLE_PERMISSIONS } from '../../../common/constants/permissions';
import {
  assertCanGrant,
  assertFreshRolePermission,
  assertOutranksRole,
  levelEdit,
} from '../../utils/role-actor.util';
import { isStoreOutage } from '../../utils/role-failure.util';
import { revokeEditedRoleHolders } from './role-edit-holders';
import { repairPendingRoleSweeps } from '../../sweeps/role-pending-repair';
import { UserRole } from '../../../user/enums/user-role.enum';
import { RoleChangeStore } from '../../stores/role-change.store';
import { PendingSweep, RoleEdit, StoredRole } from '../../stores/role-records';
import { RoleSweepStore } from '../../stores/role-sweep.store';
import { UpdateRoleDto } from '../../dto/update-role.dto';
import {
  createRoleWithinCeiling,
  rethrowRoleWriteError,
} from '../../utils/role-create.util';
import { CreateRoleDto } from '../../dto/create-role.dto';
import {
  assertValidPermissions,
  dedupePermissions,
  generateSlug,
  samePermissions,
} from '../../utils/role.util';

export interface RoleEditOutcome {
  role: StoredRole;
  usersMoved: number;
  previousSlug: string;
  nextSlug: string;
  renamed: boolean;
}

/** A stored id. Callers that still hold a database id object pass it as is. */
type RoleIdInput = string | { toString(): string };

interface RoleDeletionRepair {
  ownerId: string;
  refs: PendingSweep[];
  recorded: boolean;
}

/**
 * The transactional half of a role rename or permission edit: the role and
 * every holder's sessions move together, and one security event is recorded
 * per affected holder.
 */
@Injectable()
export class RoleEditService {
  private readonly logger = new Logger(RoleEditService.name);
  constructor(
    private readonly runner: UnitOfWorkRunner,
    private readonly changes: RoleChangeStore,
    private readonly sweeps: RoleSweepStore,
    private readonly audiences: AudiencePolicy,
  ) {}

  /**
   * Store a new custom role holding only permissions the actor holds.
   */
  async create(
    dto: CreateRoleDto,
    slug: string,
    actorId: string,
  ): Promise<StoredRole> {
    try {
      return await createRoleWithinCeiling(
        {
          runner: this.runner,
          store: this.changes,
          audiencePolicy: this.audiences,
        },
        dto,
        slug,
        actorId,
      );
    } catch (error) {
      rethrowRoleWriteError(error, slug);
    }
  }

  /**
   * Save the role and end the sessions of every holder in one unit of work.
   * The role is re-read inside the work function and the previous slug and
   * rename flag are recomputed from it, so a rename that landed before this
   * unit of work cannot make the holder match miss.
   */
  async commit(
    roleId: RoleIdInput,
    dto: UpdateRoleDto,
    actorId: string,
  ): Promise<RoleEditOutcome> {
    const id = roleId.toString();
    const requestedSlug = dto.name ? generateSlug(dto.name) : undefined;
    try {
      const outcome = await this.runner.runForAuthority(actorId, (unitOfWork) =>
        this.editInWork(unitOfWork, id, dto, actorId),
      );
      outcome.usersMoved += await this.repair(
        id,
        outcome.role.pendingHolderSweeps ?? [],
      );
      return outcome;
    } catch (error) {
      rethrowRoleWriteError(error, requestedSlug);
    }
  }

  async delete(roleId: RoleIdInput, actorId: string): Promise<void> {
    const id = roleId.toString();
    try {
      const owed = await this.runner.runForAuthority(actorId, (unitOfWork) =>
        this.deleteInWork(unitOfWork, id, actorId),
      );
      await this.repair(owed.ownerId, owed.refs, owed.recorded);
    } catch (error) {
      if (!isStoreOutage(error)) {
        throw error;
      }
      asAuthorityUnavailable(error);
    }
  }

  private async editInWork(
    unitOfWork: UnitOfWork,
    roleId: string,
    dto: UpdateRoleDto,
    actorId: string,
  ): Promise<RoleEditOutcome> {
    const actor = await assertFreshRolePermission(
      this.changes,
      unitOfWork,
      actorId,
      ROLE_PERMISSIONS.UPDATE_ALL,
    );
    const current = await this.changes.takeRoleForChange(unitOfWork, roleId);
    if (!current) {
      throw new AppException(
        ErrorCode.ROLE_NOT_FOUND,
        'Role no longer exists',
        HttpStatus.NOT_FOUND,
      );
    }
    if (this.audiences.enabled() && current.audience === undefined) {
      throw new AppException(
        ErrorCode.FORBIDDEN,
        'Map the role audience before editing it',
        HttpStatus.FORBIDDEN,
      );
    }
    assertOutranksRole(actor, current);
    if (dto.permissions) {
      // A stale edit must not restore a reserved grant removed meanwhile.
      assertValidPermissions(dto.permissions, current.permissions);
      this.audiences.assertDirectPermissions(current.audience, dto.permissions);
    }
    const addedPermissions = (dto.permissions ?? []).filter(
      (permission) => !current.permissions.includes(permission),
    );
    assertCanGrant(actor, addedPermissions);
    const level = levelEdit(actor, current, dto.level);
    const previousSlug = current.slug;
    const nextSlug = dto.name ? generateSlug(dto.name) : previousSlug;
    const renamed = nextSlug !== previousSlug;
    const permissionsChanged =
      dto.permissions !== undefined &&
      !samePermissions(current.permissions, dto.permissions);

    const edit: RoleEdit = {};
    if (dto.name && dto.name !== current.name) {
      edit.name = dto.name;
      edit.slug = nextSlug;
    }
    if (dto.description !== undefined) {
      edit.description = dto.description;
    }
    if (level !== undefined) {
      edit.level = level;
    }
    if (dto.permissions) {
      edit.permissions = dedupePermissions(dto.permissions);
    }
    if (renamed) {
      const owed = current.pendingHolderSweeps ?? [];
      if (owed.length >= ROLE_PENDING_SWEEP_LIMIT) {
        throw new AppException(
          ErrorCode.AUTHORITY_UNAVAILABLE,
          'Pending role repairs must finish before another rename',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      edit.pendingHolderSweeps = [
        ...owed,
        { roleId: current.id, previousSlug, actorId, sweepId: randomUUID() },
      ];
    }
    const role = await this.changes.saveRoleEdit(unitOfWork, roleId, edit);

    // A new level changes what holders may do, so it ends their sessions as a
    // permission change does.
    const levelChanged = level !== undefined;
    if (!renamed && !permissionsChanged && !levelChanged) {
      return { role, usersMoved: 0, previousSlug, nextSlug, renamed };
    }

    const usersMoved = await revokeEditedRoleHolders(this.changes, unitOfWork, {
      previousSlug,
      nextSlug,
      actorId,
      renamed,
      audience: current.audience,
      audiencePolicyEnabled: this.audiences.enabled(),
    });
    return {
      role,
      usersMoved: renamed ? usersMoved : 0,
      previousSlug,
      nextSlug,
      renamed,
    };
  }

  private async deleteInWork(
    unitOfWork: UnitOfWork,
    roleId: string,
    actorId: string,
  ): Promise<RoleDeletionRepair> {
    await assertFreshRolePermission(
      this.changes,
      unitOfWork,
      actorId,
      ROLE_PERMISSIONS.DELETE_ALL,
    );
    const current = await this.changes.takeRoleForChange(unitOfWork, roleId);
    if (!current) {
      throw new AppException(
        ErrorCode.ROLE_NOT_FOUND,
        'Role no longer exists',
        HttpStatus.NOT_FOUND,
      );
    }
    if (current.isSystemRole || current.isProtected) {
      throw new AppException(
        ErrorCode.ROLE_PROTECTED,
        'Role is protected',
        HttpStatus.FORBIDDEN,
      );
    }
    const count = await this.changes.countHoldersInWork(
      unitOfWork,
      current.slug,
    );
    if (count > 0) {
      throw new AppException(
        ErrorCode.ROLE_HAS_USERS,
        'Reassign role holders before deleting',
        HttpStatus.BAD_REQUEST,
        { count },
      );
    }
    const fallback = await this.changes.readRoleBySlug(
      unitOfWork,
      UserRole.USER,
    );
    if (!fallback) {
      throw new AppException(
        ErrorCode.ROLE_NOT_FOUND,
        'Default role does not exist',
        HttpStatus.NOT_FOUND,
      );
    }
    const ref = {
      roleId: current.id,
      previousSlug: current.slug,
      actorId,
      sweepId: randomUUID(),
    };
    const transferred = current.pendingHolderSweeps ?? [];
    const recorded = transferred.length > 0;
    if (recorded) {
      const refs = [
        ...(fallback.pendingHolderSweeps ?? []),
        ref,
        ...transferred,
      ];
      if (refs.length > ROLE_PENDING_SWEEP_LIMIT) {
        throw new AppException(
          ErrorCode.AUTHORITY_UNAVAILABLE,
          'Pending role repairs must finish before deleting',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      await this.changes.savePendingSweeps(unitOfWork, fallback.id, refs);
    }
    await this.changes.appendRoleDeletion(unitOfWork, ref);
    await this.changes.removeRole(unitOfWork, current.id);
    return {
      ownerId: fallback.id,
      refs: [ref, ...transferred],
      recorded,
    };
  }

  private repair(
    ownerId: string,
    refs: PendingSweep[],
    recorded = true,
  ): Promise<number> {
    return repairPendingRoleSweeps(
      {
        runner: this.runner,
        changes: this.changes,
        sweeps: this.sweeps,
        audiencePolicy: this.audiences,
      },
      { ownerId, refs, recorded, logger: this.logger },
    );
  }
}
