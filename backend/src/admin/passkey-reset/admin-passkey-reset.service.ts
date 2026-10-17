// feature:passkeys:start
import { ROLE_AUDIENCE } from '../../host/types/host-role.type';
import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { SecurityNoticeService } from '../../user/services/security-notice.service';
import { SECURITY_NOTICE } from '../../user/constants/security-notice.constants';
import {
  ENROLMENT_LINK_LIFETIME_MS,
  INVITATION_PURPOSE,
} from '../../auth/invitations/constants/invitations';
import { InvitationIssuer } from '../../auth/invitations/services/invitation-issuer';
import { InvitationMailer } from '../../auth/invitations/services/invitation-mailer';
import { invitationApplication } from '../../auth/invitations/utils/invitation-application';
import type { ActingSession } from '../../auth/proof/types/acting-session';
import { ApiResponse } from '../../common/dto/api-response.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../common/persistence/unit-of-work';
import { isAdminRole } from '../../common/utils/role-hierarchy';
import { BrowserApplications } from '../../session/applications/browser-applications';
import { REVOKED_REASON } from '../../session/constants/revoked-reason';
import { SECURITY_EVENT_ACTION } from '../../session/constants/security-event-action';
import { AccountSessions } from '../../user/stores/account-sessions';
import { USER_SCOPE_ACTION } from '../constants/user-scope-permissions';
import { AdminAccountStore } from '../stores/admin-account.store';
import { LastAdminGuard } from '../services/staff-mutations/last-admin-guard';
import { StaffMutationRules } from '../services/staff-mutations/staff-mutation-rules';
import { AdminUserAccessService } from '../services/users/admin-user-access.service';
import {
  loadAuthorizedUser,
  rethrowOrUnavailable,
} from '../utils/admin-transaction.util';
import { PasskeyResetStore } from './passkey-reset.store';

@Injectable()
export class AdminPasskeyResetService {
  constructor(
    private readonly accounts: AdminAccountStore,
    private readonly access: AdminUserAccessService,
    private readonly runner: UnitOfWorkRunner,
    private readonly rules: StaffMutationRules,
    private readonly lastAdmin: LastAdminGuard,
    private readonly passkeys: PasskeyResetStore,
    private readonly sessions: AccountSessions,
    private readonly issuer: InvitationIssuer,
    private readonly mailer: InvitationMailer,
    private readonly applications: BrowserApplications,
    @Optional() private readonly notices?: SecurityNoticeService,
  ) {}

  async reset(
    { id, version }: { id: string; version?: number },
    {
      actorId,
      session,
      permissions,
    }: {
      actorId: string;
      session?: ActingSession;
      permissions?: readonly string[];
    },
  ) {
    this.access.assertNotSelf(id, actorId, 'Cannot reset your own passkeys');
    try {
      const result = await this.runner.runForAuthority(
        actorId,
        async (work) => {
          await this.rules.policy.assertRouteProof(work, session);
          await this.lastAdmin.lock(work);
          const target = await this.target(work, id, actorId, session);
          this.access.assertTargetScope(
            USER_SCOPE_ACTION.UPDATE,
            target.audience,
            permissions,
          );
          this.rules.policy.assertVersion(version, target.version);
          if (isAdminRole(target.role))
            await this.lastAdmin.assertOthersCanSignIn(work, [target.id]);
          await this.passkeys.removeAll(work, target.id);
          this.notices?.afterCommitIn(
            work,
            target,
            SECURITY_NOTICE.PASSKEYS_RESET,
          );
          // The reset event names the actor, so the sign-out is not a second staff action.
          const revokedSessions = await this.sessions.revokeAll(
            work,
            target.id,
            { reasonCode: REVOKED_REASON.ADMIN_FORCED },
          );
          const issued = await this.issuer.issue(work, {
            purpose: INVITATION_PURPOSE.ENROLMENT,
            userId: target.id,
            audience:
              target.audience ??
              (isAdminRole(target.role) ? ROLE_AUDIENCE.STAFF : undefined),
            addressGeneration: target.addressGeneration,
            email: target.email,
            locale: target.locale,
            clientId: invitationApplication(
              { slug: target.role, audience: target.audience },
              this.applications,
            ),
            lifetimeMs: ENROLMENT_LINK_LIFETIME_MS,
          });
          await this.rules.events.record(work, {
            action: SECURITY_EVENT_ACTION.PASSKEYS_RESET,
            actorId,
            targetUserId: target.id,
            clientId: session?.clientId,
            details: {},
          });
          const saved = await this.accounts.readAccount(work, target.id);
          return {
            ...issued,
            id: target.id,
            revokedSessions,
            version: saved?.version ?? 0,
          };
        },
      );
      await this.mailer.sendEnrolmentLink(result.invitation, result.token);
      return ApiResponse.success({
        id: result.id,
        revokedSessions: result.revokedSessions,
        version: result.version,
      });
    } catch (error) {
      rethrowOrUnavailable(error);
    }
  }

  private async target(
    work: UnitOfWork,
    id: string,
    actorId: string,
    session?: ActingSession,
  ) {
    const target = await this.accounts.takeAccountForChange(work, id);
    if (!target || target.isDeleted)
      throw new AppException(
        ErrorCode.USER_NOT_FOUND,
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    if (!isAdminRole(target.role))
      return loadAuthorizedUser(this.accounts, this.access, work, id, actorId);
    const actor = await this.accounts.readAccount(work, actorId);
    if (!actor || actor.isDeleted)
      throw new AppException(
        ErrorCode.SESSION_INVALID,
        'Actor is no longer active',
        HttpStatus.UNAUTHORIZED,
      );
    if (!isAdminRole(actor.role))
      throw new AppException(
        ErrorCode.FORBIDDEN,
        'Only administrators may reset administrators',
        HttpStatus.FORBIDDEN,
      );
    await this.rules.policy.assertAct(work, session);
    await this.access.assertTargetScopeInWork(
      work,
      actorId,
      target.audience,
      USER_SCOPE_ACTION.UPDATE,
    );
    return target;
  }
}
// feature:passkeys:end
