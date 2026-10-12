import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { HashService } from '../../../common/services/hash.service';
import { isUnknownTransactionOutcome } from '../../../common/exceptions/unknown-transaction-outcome.error';
import { UniqueConflictError } from '../../../common/persistence/persistence-errors';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { RoleChangeStore } from '../../../role/stores/role-change.store';
import { RoleSweepStore } from '../../../role/stores/role-sweep.store';
import { RoleSweepStores } from '../../../role/sweeps/role-holder-sweep';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { CreateUserDto } from '../../dto/create-user.dto';
import { AdminUserDto } from '../../dto/admin-user-response.dto';
import { mapToAdminUserDto } from '../../mappers/admin-user.mapper';
import { AdminAccountStore } from '../../stores/admin-account.store';
import { rethrowOrUnavailable } from '../../utils/admin-transaction.util';
import { AdminUserAccessService } from './admin-user-access.service';
import { reconcileAssignedRole } from '../../utils/admin-role-reconcile.util';
import type { AssignedRoleRef } from '../../types/assigned-role-ref';
import { USER_PERMISSIONS } from '../../../common/constants/permissions';
import { assertActorHoldsRole } from '../roles/admin-grant-ceiling';

/**
 * Creating an account from the admin area. The role must exist and sit below
 * the actor's level, and the created slug is repaired if a rename lands while
 * the account is written.
 */
@Injectable()
export class AdminUserCreateService {
  private readonly logger = new Logger(AdminUserCreateService.name);

  constructor(
    private readonly accounts: AdminAccountStore,
    private readonly runner: UnitOfWorkRunner,
    private readonly roleChanges: RoleChangeStore,
    private readonly roleSweeps: RoleSweepStore,
    private readonly accessService: AdminUserAccessService,
    private readonly hashService: HashService,
  ) {}

  /**
   * Create a user. The role must exist and sit below the actor's level.
   */
  async createUser(
    dto: CreateUserDto,
    actorRole: string,
    actorId: string,
  ): Promise<ApiResponse<AdminUserDto>> {
    const { email, name, password, role } = dto;

    if (await this.accounts.isAddressTaken(email)) {
      throw new AppException(
        ErrorCode.EMAIL_ALREADY_EXISTS,
        'Email already in use',
        HttpStatus.CONFLICT,
      );
    }

    await this.accessService.assertCanAssignRole(actorRole, role);

    const hashedPassword = await this.hashService.hash(password);
    const roles = this.roleStores();
    let createdUserId: string | undefined;
    let assignmentRef: AssignedRoleRef | undefined;
    let transactionAcknowledged = false;
    try {
      const outcome = await this.runner.run(async (unitOfWork) => {
        const assignedRole = await this.accounts.readRoleBySlug(
          unitOfWork,
          role,
        );
        if (!assignedRole) {
          throw new AppException(
            ErrorCode.ROLE_NOT_FOUND,
            `Role "${role}" does not exist`,
            HttpStatus.NOT_FOUND,
          );
        }
        await this.accessService.assertFreshActorCanModify(
          actorId,
          assignedRole.slug,
          unitOfWork,
        );
        await assertActorHoldsRole(
          this.roleChanges,
          unitOfWork,
          actorId,
          USER_PERMISSIONS.CREATE_ALL,
          assignedRole.slug,
        );
        const newUser = await this.accounts.insertAccount(unitOfWork, {
          email,
          name,
          passwordHash: hashedPassword,
          role: assignedRole.slug,
        });
        createdUserId = newUser.id;
        assignmentRef = {
          roleId: assignedRole.id,
          assignedSlug: assignedRole.slug,
          created: {
            updatedAt: newUser.updatedAt,
            sessionVersion: newUser.sessionVersion,
          },
        };
        return { newUser, roleId: assignedRole.id };
      });
      transactionAcknowledged = true;
      const { newUser } = outcome;
      const liveRole = await reconcileAssignedRole({
        accounts: this.accounts,
        roles,
        logger: this.logger,
        actorId,
        userId: newUser.id,
        ref: {
          roleId: outcome.roleId,
          assignedSlug: role,
          created: {
            updatedAt: newUser.updatedAt,
            sessionVersion: newUser.sessionVersion,
          },
        },
      });
      this.logger.log(
        `User created by admin: userId=${newUser.id} as ${liveRole}`,
      );
      return ApiResponse.success(
        mapToAdminUserDto({ ...newUser, role: liveRole }),
        'User created successfully',
      );
    } catch (error) {
      if (error instanceof UniqueConflictError) {
        throw new AppException(
          ErrorCode.EMAIL_ALREADY_EXISTS,
          'Email already in use',
          HttpStatus.CONFLICT,
        );
      }
      if (
        !transactionAcknowledged &&
        isUnknownTransactionOutcome(error) &&
        createdUserId &&
        assignmentRef
      ) {
        try {
          await reconcileAssignedRole({
            accounts: this.accounts,
            roles,
            logger: this.logger,
            actorId,
            userId: createdUserId,
            ref: assignmentRef,
          });
        } catch {
          // A role rename or deletion also records its own durable sweep.
        }
      }
      rethrowOrUnavailable(error);
    }
  }

  private roleStores(): RoleSweepStores {
    return {
      runner: this.runner,
      changes: this.roleChanges,
      sweeps: this.roleSweeps,
    };
  }
}
