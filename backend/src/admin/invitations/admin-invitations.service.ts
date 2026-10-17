import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { INVITATION_EXPIRES_IN_DEFAULT } from '../../config/constants/host-contracts';
import { INVITATION_PURPOSE } from '../../auth/invitations/constants/invitations';
import { InvitationIssuer } from '../../auth/invitations/services/invitation-issuer';
import { InvitationMailer } from '../../auth/invitations/services/invitation-mailer';
import { InvitationStore } from '../../auth/invitations/stores/invitation.store';
import { invitationApplication } from '../../auth/invitations/utils/invitation-application';
import { chosenLocale } from '../../common/constants/locales';
import { ApiResponse } from '../../common/dto/api-response.dto';
import { UnitOfWorkRunner } from '../../common/persistence/unit-of-work';
import { Clock } from '../../common/services/clock';
import { BrowserApplications } from '../../session/applications/browser-applications';
import { SECURITY_EVENT_ACTION } from '../../session/constants/security-event-action';
import { STAFF_OPERATION } from '../constants/staff-operations';
import { USER_SCOPE_ACTION } from '../constants/user-scope-permissions';
import { AdminAccountStore } from '../stores/admin-account.store';
import { idempotencyKeyReused } from '../utils/request-fingerprint';
import { StaffMutationRules } from '../services/staff-mutations/staff-mutation-rules';
import { AdminUserAccessService } from '../services/users/admin-user-access.service';
import { rethrowOrUnavailable } from '../utils/admin-transaction.util';
import { AdminInvitationAccessService } from './admin-invitation-access.service';
import { mapAdminInvitation } from './admin-invitation.mapper';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { InvitationQueryDto } from './dto/invitation-query.dto';
import type { InvitationActor } from './types/invitation-request';

@Injectable()
export class AdminInvitationsService {
  constructor(
    private readonly invitations: InvitationStore,
    private readonly issuer: InvitationIssuer,
    private readonly mailer: InvitationMailer,
    private readonly runner: UnitOfWorkRunner,
    private readonly authority: AdminInvitationAccessService,
    private readonly access: AdminUserAccessService,
    private readonly accounts: AdminAccountStore,
    private readonly rules: StaffMutationRules,
    private readonly applications: BrowserApplications,
    private readonly config: ConfigService,
    private readonly clock: Clock,
  ) {}

  async list(query: InvitationQueryDto, permissions?: readonly string[]) {
    try {
      const result = await this.invitations.list({
        ...query,
        now: this.clock.now(),
        audiences: this.access.allowedAudiences(
          USER_SCOPE_ACTION.LIST,
          permissions,
        ),
      });
      return ApiResponse.success({
        invitations: result.invitations.map((invitation) =>
          mapAdminInvitation(invitation, this.clock.now()),
        ),
        total: result.total,
        page: query.page,
        pages: Math.ceil(result.total / query.limit),
      });
    } catch (error) {
      rethrowOrUnavailable(error);
    }
  }

  async create(dto: CreateInvitationDto, actor: InvitationActor, key?: string) {
    this.rules.policy.assertKey(key);
    const create = {
      key,
      actorId: actor.id,
      clientId: actor.session?.clientId ?? '',
      operation: STAFF_OPERATION.INVITATION_CREATE,
      body: dto,
    };
    try {
      const result = await this.runner.runForAuthority(
        actor.id,
        async (work) => {
          await this.rules.policy.assertRouteProof(work, actor.session);
          const start = await this.rules.idempotency.start(work, create);
          if (start.replayed) {
            if (!('invitation' in start.result)) throw idempotencyKeyReused();
            const invitation = start.result.invitation;
            await this.authority.authorizeReplay(work, invitation, actor);
            return { response: invitation };
          }
          const role = await this.authority.authorizeCreate(work, dto, actor);
          const issued = await this.issuer.issue(work, {
            purpose: INVITATION_PURPOSE.ACCOUNT,
            email: dto.email,
            name: dto.name,
            locale: chosenLocale(dto.locale),
            role,
            invitedBy: actor.id,
            clientId: invitationApplication(role, this.applications),
            lifetimeMs: this.lifetime(),
          });
          await this.rules.events.record(work, {
            action: SECURITY_EVENT_ACTION.INVITATION_CREATED,
            actorId: actor.id,
            clientId: actor.session?.clientId,
            details: {
              ...(dto.name === undefined ? {} : { name: dto.name }),
              email: issued.invitation.email,
              roleId: role.id,
            },
          });
          await this.rules.idempotency.finish(
            work,
            create,
            issued.invitation.id,
            {
              invitation: mapAdminInvitation(
                issued.invitation,
                this.clock.now(),
              ),
            },
          );
          const inviter = await this.accounts.readAccount(work, actor.id);
          return {
            ...issued,
            inviterName: inviter?.name,
            response: mapAdminInvitation(issued.invitation, this.clock.now()),
          };
        },
      );
      if ('token' in result && typeof result.token === 'string') {
        await this.mailer.sendInvitation(
          result.invitation,
          result.token,
          result.inviterName,
        );
      }
      return ApiResponse.success(result.response);
    } catch (error) {
      rethrowOrUnavailable(error);
    }
  }

  async resend(id: string, actor: InvitationActor) {
    try {
      const result = await this.runner.runForAuthority(
        actor.id,
        async (work) => {
          const current = await this.authority.load(work, id, actor);
          await this.authority.authorizeInvitation(work, current, actor);
          const token = await this.issuer.reissue(
            work,
            current,
            this.lifetime(),
          );
          const invitation = await this.authority.load(work, id, actor);
          await this.rules.events.record(work, {
            action: SECURITY_EVENT_ACTION.INVITATION_RESENT,
            actorId: actor.id,
            clientId: actor.session?.clientId,
            details: { email: invitation.email },
          });
          const inviter = await this.accounts.readAccount(work, actor.id);
          return { invitation, token, inviterName: inviter?.name };
        },
      );
      await this.mailer.sendInvitation(
        result.invitation,
        result.token,
        result.inviterName,
      );
      return ApiResponse.success(
        mapAdminInvitation(result.invitation, this.clock.now()),
      );
    } catch (error) {
      rethrowOrUnavailable(error);
    }
  }

  async revoke(id: string, actor: InvitationActor): Promise<void> {
    try {
      await this.runner.runForAuthority(actor.id, async (work) => {
        const invitation = await this.authority.load(work, id, actor);
        await this.authority.authorizeRevocation(work, invitation, actor);
        await this.issuer.revoke(work, invitation, this.clock.now());
        await this.rules.events.record(work, {
          action: SECURITY_EVENT_ACTION.INVITATION_REVOKED,
          actorId: actor.id,
          clientId: actor.session?.clientId,
          details: {},
        });
      });
    } catch (error) {
      rethrowOrUnavailable(error);
    }
  }

  private lifetime(): number {
    return this.config.get<number>(
      'invitations.expiresIn',
      INVITATION_EXPIRES_IN_DEFAULT,
    );
  }
}
