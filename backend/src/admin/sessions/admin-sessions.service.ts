import { HttpStatus, Injectable } from '@nestjs/common';
import { SESSION_PERMISSIONS } from '../../common/constants/permissions';
import { ApiResponse } from '../../common/dto/api-response.dto';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { AppException } from '../../common/exceptions/app.exception';
import { IdFormat } from '../../common/persistence/id-format';
import { UnitOfWorkRunner } from '../../common/persistence/unit-of-work';
import { SessionValidator } from '../../session/authority/session-validator';
import { REVOKED_REASON } from '../../session/constants/revoked-reason';
import { SessionRevoker } from '../../session/revocation/session-revoker';
import { assertValidId } from '../../user/utils/user-lookup.util';
import { rethrowOrUnavailable } from '../utils/admin-transaction.util';
import { AdminSessionAccessService } from './admin-session-access.service';
import { AdminSessionListData } from './dto/admin-session-response.dto';
import { toAdminSessionDto } from './mappers/admin-session.mapper';
import { sessionTargetClass } from './utils/admin-session-scope';
import type { ActingSession } from '../../auth/proof/types/acting-session';

@Injectable()
export class AdminSessionsService {
  constructor(
    private readonly access: AdminSessionAccessService,
    private readonly validator: SessionValidator,
    private readonly revoker: SessionRevoker,
    private readonly runner: UnitOfWorkRunner,
    private readonly ids: IdFormat,
  ) {}

  async list(
    targetId: string,
    actorId: string,
    session?: ActingSession,
  ): Promise<ApiResponse<AdminSessionListData>> {
    assertValidId(this.ids, targetId, 'Invalid user ID format');
    try {
      const target = await this.runner.run((unitOfWork) =>
        this.access.authorizeIn(
          unitOfWork,
          targetId,
          actorId,
          {
            route: SESSION_PERMISSIONS.READ_ALL,
            staff: SESSION_PERMISSIONS.READ_STAFF,
          },
          session,
        ),
      );
      // The list shows only sessions whose application and grant are active.
      const sessions = (await this.validator.listActive(target.id)).map(
        toAdminSessionDto,
      );
      return ApiResponse.success({
        sessions,
        total: sessions.length,
        targetClass: sessionTargetClass(target),
      });
    } catch (error) {
      rethrowOrUnavailable(error);
    }
  }

  async revokeOne(
    targetId: string,
    sessionId: string,
    actorId: string,
    session?: ActingSession,
  ): Promise<ApiResponse<{ revoked: true }>> {
    assertValidId(this.ids, targetId, 'Invalid user ID format');
    assertValidId(this.ids, sessionId, 'Invalid session ID format');
    try {
      await this.runner.run(async (unitOfWork) => {
        const target = await this.access.authorizeIn(
          unitOfWork,
          targetId,
          actorId,
          {
            route: SESSION_PERMISSIONS.DELETE_ALL,
            staff: SESSION_PERMISSIONS.DELETE_STAFF,
          },
          session,
        );
        const revoked = await this.revoker.revokeByIdIn(
          unitOfWork,
          sessionId,
          target.id,
          { actorId, reasonCode: REVOKED_REASON.ADMIN_FORCED },
        );
        if (!revoked) throw sessionNotFound();
      });
      return ApiResponse.success({ revoked: true });
    } catch (error) {
      rethrowOrUnavailable(error);
    }
  }

  async revokeAll(
    targetId: string,
    actorId: string,
    session?: ActingSession,
  ): Promise<ApiResponse<{ revokedCount: number }>> {
    assertValidId(this.ids, targetId, 'Invalid user ID format');
    try {
      const revokedCount = await this.runner.run(async (unitOfWork) => {
        const target = await this.access.authorizeIn(
          unitOfWork,
          targetId,
          actorId,
          {
            route: SESSION_PERMISSIONS.DELETE_ALL,
            staff: SESSION_PERMISSIONS.DELETE_STAFF,
          },
          session,
        );
        return this.revoker.revokeAllForUserIn(unitOfWork, target.id, {
          actorId,
          reasonCode: REVOKED_REASON.ADMIN_FORCED,
        });
      });
      return ApiResponse.success({ revokedCount });
    } catch (error) {
      rethrowOrUnavailable(error);
    }
  }
}

function sessionNotFound(): AppException {
  return new AppException(
    ErrorCode.SESSION_NOT_FOUND,
    'Session not found or already revoked',
    HttpStatus.NOT_FOUND,
  );
}
