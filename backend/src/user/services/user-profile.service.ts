import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserRole } from '../enums/user-role.enum';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { UserProfileDto } from '../dto/user-profile.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { effectivePermissions } from '../../auth/utils/permissions.util';
import { Clock } from '../../common/services/clock';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { ApiResponse } from '../../common/dto/api-response.dto';
import { runLeavingFailuresAsRaised } from '../../common/persistence/store-failure';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../common/persistence/unit-of-work';
import { HashService } from '../../common/services/hash.service';
import { SecurityNoticeService } from './security-notice.service';
import { SECURITY_NOTICE } from '../constants/security-notice.constants';
import { AccountProfileStore } from '../stores/account-profile.store';
import { AccountSessions } from '../stores/account-sessions';
import { StoredAccount } from '../stores/stored-account';
import {
  assertAccountId,
  assertActiveUser,
} from '../utils/account-lookup.util';
import { AccountDeletionService } from '../erasure/services/account-deletion.service';
import type { AccountDeletionResultDto } from '../erasure/dto/account-deletion.dto';
import type { DeletionOutcome } from '../erasure/types/account-deletion';

/**
 * Self-service profile operations: reading and updating the profile,
 * changing the password, and deactivating the account.
 */
@Injectable()
export class UserProfileService {
  private readonly logger = new Logger(UserProfileService.name);

  constructor(
    private readonly accounts: AccountProfileStore,
    private readonly sessions: AccountSessions,
    private readonly runner: UnitOfWorkRunner,
    private readonly clock: Clock,
    private readonly hashService: HashService,
    private readonly deletion: AccountDeletionService,
    private readonly notices?: SecurityNoticeService,
  ) {}

  /**
   * Get current user profile.
   */
  async getProfile(userId: string): Promise<ApiResponse<UserProfileDto>> {
    this.assertAccountId(userId);

    const user = await this.accounts.findProfile(userId);

    assertActiveUser(user);

    this.logger.log(`Profile retrieved: userId=${user.id}`);
    const profileDto = await this.mapToProfileDto(user);
    return ApiResponse.success(profileDto);
  }

  /**
   * Update current user profile.
   */
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<ApiResponse<UserProfileDto>> {
    this.assertAccountId(userId);
    const expectedVersion = dto.version;
    const changes = { name: dto.name, locale: dto.locale };

    const saved = await runLeavingFailuresAsRaised(
      this.runner,
      async (unitOfWork) => {
        const user = await this.accounts.readAccount(unitOfWork, userId);
        assertActiveUser(user);
        assertObservedProfileVersion(expectedVersion, user);
        return this.accounts.saveProfile(unitOfWork, user, changes);
      },
    );
    const profileDto = await this.mapToProfileDto(saved);
    this.logger.log(`Profile updated: userId=${saved.id}`);
    return ApiResponse.success(profileDto, 'Profile updated successfully');
  }

  /**
   * Change user password.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    currentSessionId: string | null,
  ): Promise<ApiResponse<{ message: string }>> {
    this.assertAccountId(userId);

    if (currentSessionId === null) {
      throw new AppException(
        ErrorCode.SESSION_INVALID,
        'Current session is no longer active',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const user = await this.accounts.findPassword(userId);

    assertActiveUser(user);

    // Check if user has a password (OAuth users might not)
    if (!user.passwordHash) {
      throw new AppException(
        ErrorCode.INVALID_CURRENT_PASSWORD,
        'Cannot change password for OAuth-only accounts',
        HttpStatus.BAD_REQUEST,
      );
    }

    const isPasswordValid = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new AppException(
        ErrorCode.INVALID_CURRENT_PASSWORD,
        'Current password is incorrect',
        HttpStatus.BAD_REQUEST,
      );
    }

    const isSamePassword = await bcrypt.compare(
      dto.newPassword,
      user.passwordHash,
    );

    if (isSamePassword) {
      throw new AppException(
        ErrorCode.SAME_PASSWORD,
        'New password must be different from current password',
        HttpStatus.BAD_REQUEST,
      );
    }

    const hashedPassword = await this.hashService.hash(dto.newPassword);

    // The password save and the revocation of the other sessions share one
    // unit of work: a revocation failure leaves the old password in place.
    // The account is read per attempt, so a rerun writes the hash again
    // instead of trusting what a refused attempt already wrote.
    await runLeavingFailuresAsRaised(this.runner, async (unitOfWork) => {
      const current = await this.accounts.readAccount(unitOfWork, userId);
      assertActiveUser(current);
      await this.accounts.savePasswordHash(unitOfWork, current, hashedPassword);
      await this.sessions.revokeAllExcept(unitOfWork, userId, currentSessionId);
    });

    this.logger.log(`Password changed: userId=${user.id}`);
    this.notices?.defer(user.id, SECURITY_NOTICE.PASSWORD_CHANGED);
    return ApiResponse.success({
      message:
        'Password changed successfully. Other sessions have been logged out.',
    });
  }

  /**
   * Soft delete (deactivate) own account, and while erasure is on, schedule
   * its erasure. The last active admin is refused: nobody else could restore
   * the account. A receipt key is stored with the deletion, and the same key
   * sent again gets the same answer without a second deletion.
   */
  async deactivateAccount(
    userId: string,
    receiptKey?: string,
    authorize?: (unitOfWork: UnitOfWork) => Promise<void>,
  ): Promise<ApiResponse<AccountDeletionResultDto>> {
    const key = this.deletion.receiptKeyOf(receiptKey);
    // The check, the soft delete, the schedule, the receipt and the revocation
    // commit or abort together.
    const outcome = await runLeavingFailuresAsRaised(
      this.runner,
      async (unitOfWork): Promise<DeletionOutcome> => {
        const repeated = await this.deletion.repeatedIn(
          unitOfWork,
          userId,
          key,
        );
        if (repeated) return repeated;
        const user = await this.accounts.readAccount(unitOfWork, userId);
        assertActiveUser(user);
        await authorize?.(unitOfWork);
        if (user.role === (UserRole.ADMIN as string)) {
          await this.assertAnotherActiveAdmin(unitOfWork, user.id);
        }

        const deletedAt = this.clock.now();
        await this.accounts.saveDeactivation(unitOfWork, user, deletedAt);
        const recorded = await this.deletion.recordIn(
          unitOfWork,
          user,
          deletedAt,
          key,
        );

        await this.sessions.revokeAll(unitOfWork, user.id);
        return recorded;
      },
    );

    this.logger.log(`Account deactivated: userId=${userId}`);
    this.deletion.afterCommit(outcome, this.clock.now());
    return ApiResponse.success({
      message: 'Account deactivated successfully',
      ...(outcome.eraseAfter && {
        eraseAfter: outcome.eraseAfter.toISOString(),
      }),
    });
  }

  private async assertAnotherActiveAdmin(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<void> {
    const others = await this.accounts.countOtherActiveAdmins(
      unitOfWork,
      userId,
    );
    if (others === 0) {
      throw new AppException(
        ErrorCode.ADMIN_CANNOT_DEACTIVATE_SELF,
        'The last active administrator cannot deactivate their own account',
        HttpStatus.FORBIDDEN,
      );
    }
    // Two admins leaving at once each count the other. Both pass the same
    // fence here, so one is refused, runs again and counts again.
    const fence = await this.accounts.fenceAdminRole(unitOfWork);
    if (fence !== 'fenced') {
      throw new AppException(
        ErrorCode.AUTHORITY_UNAVAILABLE,
        'Administrator role is unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Provider a user syncs its profile from, if any.
   */
  async getPrimaryProvider(userId: string): Promise<string | undefined> {
    return this.accounts.findPrimaryProvider(userId);
  }

  private assertAccountId(userId: string): void {
    assertAccountId(
      this.accounts.isAccountId(userId),
      'Invalid user ID format',
    );
  }

  /**
   * Map a stored account to the profile DTO.
   */
  private async mapToProfileDto(user: StoredAccount): Promise<UserProfileDto> {
    // Resolved the way the guard resolves them for a request.
    const permissions = effectivePermissions(
      user.role ? await this.accounts.findRolePermissions(user.role) : null,
      user.permissions,
    );
    const passkeyCount = await this.accounts.countPasskeys(user.id); // feature:passkeys

    return {
      id: user.id,
      version: user.version ?? 0,
      email: user.email,
      name: user.name,
      role: user.role,
      permissions,
      authProvider: user.authProvider,
      isVerified: user.isVerified,
      twoFactorEnabled: user.twoFactorEnabled, // feature:totp
      passkeyCount, // feature:passkeys
      avatarUrl: user.avatarUrl,
      linkedProviders: user.linkedProviders,
      primaryProvider: user.primaryProvider,
      profileSyncedAt: user.profileSyncedAt,
      locale: user.locale,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}

function assertObservedProfileVersion(
  sent: number | undefined,
  user: StoredAccount,
): void {
  const current = user.version ?? 0;
  if (sent !== undefined && sent !== current) {
    throw new AppException(
      ErrorCode.CONFLICT,
      'Account changed since it was loaded.',
      HttpStatus.CONFLICT,
      { version: current },
    );
  }
}
