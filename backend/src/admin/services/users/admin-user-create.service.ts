import { USER_SCOPE_ACTION } from '../../constants/user-scope-permissions';
import { AudiencePolicy } from '../../../session/applications/audience-policy';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../../common/services/clock';
import {
  ACCOUNT_RESERVATION_RESULT,
  AddressLedger,
} from '../../../common/persistence/address-ledger';
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
import { assertActorHoldsRole } from '../roles/admin-grant-ceiling';
import { chosenLocale } from '../../../common/constants/locales';
import { AccountCreationPolicy } from '../../../auth/services/registration/account-creation-policy';
import { ACCOUNT_CREATION_METHOD } from '../../../auth/constants/account-creation';
import type { ActingSession } from '../../../auth/proof/types/acting-session';
import { SECURITY_EVENT_ACTION } from '../../../session/constants/security-event-action';
import { STAFF_OPERATION } from '../../constants/staff-operations';
import { StaffMutationRules } from '../staff-mutations/staff-mutation-rules';
import { idempotencyKeyReused } from '../../utils/request-fingerprint';

/** The request facts a create carries beside its body. */
export interface CreateRequest {
  session?: ActingSession;
  /** The Idempotency-Key header, when sent. */
  key?: string;
}

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
    private readonly policy: AccountCreationPolicy,
    private readonly ledger: AddressLedger,
    private readonly clock: Clock,
    private readonly audiences: AudiencePolicy,
    private readonly rules: StaffMutationRules,
  ) {}

  /**
   * Create a user. The role must exist and sit below the actor's level. The
   * account stores the language the body names, or the default: the actor's
   * own language is not the new person's.
   */
  async createUser(
    dto: CreateUserDto,
    actorRole: string,
    actorId: string,
    actorPermissions?: readonly string[],
    request: CreateRequest = {},
  ): Promise<ApiResponse<AdminUserDto>> {
    const locale = chosenLocale(dto.locale);
    const { email, name, password, role } = dto;
    this.rules.policy.assertKey(request.key);
    const hashedPassword = await this.hashService.hash(password);
    const create = {
      key: request.key,
      actorId,
      clientId: request.session?.clientId ?? '',
      operation: STAFF_OPERATION.ACCOUNT_CREATE,
      body: dto,
      password,
      secretHash: hashedPassword,
    };

    // A replay finds its own account there; the transaction still refuses a taken address.
    if (
      request.key === undefined &&
      (await this.accounts.isAddressTaken(email))
    ) {
      throw new AppException(
        ErrorCode.EMAIL_ALREADY_EXISTS,
        'Email already in use',
        HttpStatus.CONFLICT,
      );
    }

    const roles = this.roleStores();
    let createdUserId: string | undefined;
    let assignmentRef: AssignedRoleRef | undefined;
    let transactionAcknowledged = false;
    try {
      const outcome = await this.runner.runForAuthority(
        actorId,
        async (unitOfWork) => {
          await this.rules.policy.assertRouteProof(unitOfWork, request.session);
          const start = await this.rules.idempotency.start(unitOfWork, create);
          if (start.replayed) {
            if (!('account' in start.result)) throw idempotencyKeyReused();
            this.accessService.assertTargetScope(
              USER_SCOPE_ACTION.CREATE,
              start.result.audience,
              actorPermissions,
            );
            await this.accessService.assertCreateReplay(
              unitOfWork,
              actorId,
              start.result.audience,
            );
            return { replayed: start.result.account };
          }
          await this.accessService.assertCanAssignRole(actorRole, role);
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
          this.accessService.assertTargetScope(
            USER_SCOPE_ACTION.CREATE,
            assignedRole.audience,
            actorPermissions,
          );
          await this.accessService.assertTargetScopeInWork(
            unitOfWork,
            actorId,
            assignedRole.audience,
            USER_SCOPE_ACTION.CREATE,
          );
          await this.accessService.assertFreshActorCanModify(
            actorId,
            assignedRole.slug,
            unitOfWork,
          );
          await assertActorHoldsRole(
            this.roleChanges,
            unitOfWork,
            actorId,
            this.accessService.scopePermission(
              USER_SCOPE_ACTION.CREATE,
              assignedRole.audience,
            ),
            assignedRole.slug,
          );
          await this.policy.assertMayCreate(
            { application: null, method: ACCOUNT_CREATION_METHOD.STAFF },
            unitOfWork,
          );
          const reservation = await this.ledger.reserveForAccount(unitOfWork, {
            address: email,
            now: this.clock.now(),
          });
          if (reservation.status === ACCOUNT_RESERVATION_RESULT.TAKEN) {
            throw new AppException(
              ErrorCode.EMAIL_ALREADY_EXISTS,
              'Email already in use',
              HttpStatus.CONFLICT,
            );
          }
          const newUser = await this.accounts.insertAccount(unitOfWork, {
            email,
            name,
            passwordHash: hashedPassword,
            role: assignedRole.slug,
            audience: assignedRole.audience,
            locale,
          });
          await this.ledger.finishAccountReservation(
            unitOfWork,
            reservation.reservation,
          );
          await this.rules.idempotency.finish(unitOfWork, create, newUser.id, {
            account: mapToAdminUserDto(newUser, null),
            audience: assignedRole.audience,
          });
          await this.rules.events.record(unitOfWork, {
            action: SECURITY_EVENT_ACTION.ACCOUNT_CREATED,
            actorId,
            targetUserId: newUser.id,
            clientId: request.session?.clientId,
            details: {
              name: newUser.name,
              email: newUser.email,
              roleId: assignedRole.id,
            },
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
        },
      );
      transactionAcknowledged = true;
      if (outcome.replayed !== undefined) {
        return ApiResponse.success(
          outcome.replayed,
          'User created successfully',
        );
      }
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
        mapToAdminUserDto(
          {
            ...newUser,
            role: request.key === undefined ? liveRole : newUser.role,
          },
          null,
        ),
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
      audiencePolicy: this.audiences,
    };
  }
}
