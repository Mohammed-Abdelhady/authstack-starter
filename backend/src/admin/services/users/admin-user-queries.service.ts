import { USER_SCOPE_ACTION } from '../../constants/user-scope-permissions';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ListUsersQueryDto } from '../../dto/list-users-query.dto';
import { AdminUserDto, UserListData } from '../../dto/admin-user-response.dto';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { mapToAdminUserDto } from '../../mappers/admin-user.mapper';
import { AdminAccountStore } from '../../stores/admin-account.store';
import { AdminUserAccessService } from './admin-user-access.service';

/**
 * Read paths of the admin user area.
 * Reads use the non-strict hierarchy comparison, so an actor also sees peers.
 */
@Injectable()
export class AdminUserQueriesService {
  private readonly logger = new Logger(AdminUserQueriesService.name);

  constructor(
    private readonly accounts: AdminAccountStore,
    private readonly accessService: AdminUserAccessService,
  ) {}

  /**
   * List every user whose role sits at or below the actor's level,
   * custom roles included.
   */
  async listUsers(
    query: ListUsersQueryDto,
    actorRole: string,
    actorPermissions?: readonly string[],
  ): Promise<ApiResponse<UserListData>> {
    const {
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;
    const viewableRoles = await this.accessService.getViewableSlugs(actorRole);
    const { accounts: users, total } = await this.accounts.listAccounts({
      search: query.search,
      role: query.role,
      status: query.status,
      isVerified: query.isVerified,
      viewableRoles,
      audiences: this.accessService.allowedAudiences(
        USER_SCOPE_ACTION.LIST,
        actorPermissions,
      ),
      page,
      limit,
      sortBy,
      sortOrder,
    });

    this.logger.log(`Listed ${users.length} users (page ${page}, ${total})`);
    return ApiResponse.success({
      data: users.map((user) => mapToAdminUserDto(user)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }

  /**
   * Read a single user the actor is allowed to see.
   */
  async getUserById(
    id: string,
    actorRole: string,
    actorPermissions?: readonly string[],
  ): Promise<ApiResponse<AdminUserDto>> {
    const user = await this.accounts.findAccountView(id);

    if (!user || user.isDeleted) {
      this.logger.warn(`User not found or deleted: ${id}`);
      throw new AppException(
        ErrorCode.USER_NOT_FOUND,
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }

    this.accessService.assertTargetScope(
      USER_SCOPE_ACTION.READ,
      user.audience,
      actorPermissions,
    );
    await this.accessService.assertCanView(actorRole, user.role);

    return ApiResponse.success(mapToAdminUserDto(user));
  }
}
