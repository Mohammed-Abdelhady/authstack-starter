import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminAccountStore } from '../admin/stores/admin-account.store';
import { AdminRosterStore } from '../admin/stores/admin-roster.store';
import { EventRecorder } from '../auth/contracts/event-recorder';
import { INVITATION_PURPOSE } from '../auth/invitations/constants/invitations';
import { InvitationIssuer } from '../auth/invitations/services/invitation-issuer';
import { InvitationMailer } from '../auth/invitations/services/invitation-mailer';
import { InvitationStore } from '../auth/invitations/stores/invitation.store';
import { chosenLocale } from '../common/constants/locales';
import { UnitOfWorkRunner } from '../common/persistence/unit-of-work';
import { Clock } from '../common/services/clock';
import { INVITATION_EXPIRES_IN_DEFAULT } from '../config/constants/host-contracts';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../session/constants/client-ids';
import { SECURITY_EVENT_ACTION } from '../session/constants/security-event-action';
import { UserRole } from '../user/enums/user-role.enum';
import { SERVER_COMMAND_ACTOR } from './admin-command.constants';
import { AdminCommandError } from './admin-command-error';
import type { AdminInviteOptions } from './types/admin-command';

@Injectable()
export class AdminInviteService {
  constructor(
    private readonly runner: UnitOfWorkRunner,
    private readonly roster: AdminRosterStore,
    private readonly accounts: AdminAccountStore,
    private readonly invitations: InvitationStore,
    private readonly issuer: InvitationIssuer,
    private readonly mailer: InvitationMailer,
    private readonly events: EventRecorder,
    private readonly config: ConfigService,
    private readonly clock: Clock,
  ) {}

  async invite(options: AdminInviteOptions) {
    const issued = await this.runner.run(async (work) => {
      await this.roster.lock(work);
      if (await this.roster.hasActiveAdministrator(work))
        throw new AdminCommandError('An active administrator already exists');
      if (
        await this.invitations.hasOpenAdminInvitation(
          work,
          UserRole.ADMIN,
          this.clock.now(),
        )
      ) {
        throw new AdminCommandError(
          'An open administrator invitation already exists',
        );
      }
      const role = await this.accounts.readRoleBySlug(work, UserRole.ADMIN);
      if (!role) throw new AdminCommandError('Administrator role not found');
      const result = await this.issuer.issue(work, {
        purpose: INVITATION_PURPOSE.FIRST_ADMIN,
        role,
        email: options.email,
        name: options.name,
        locale: chosenLocale(options.locale),
        clientId: this.config.get<string>('cors.adminUrl')
          ? ADMIN_CLIENT_ID
          : WEB_CLIENT_ID,
        lifetimeMs: this.config.get<number>(
          'invitations.expiresIn',
          INVITATION_EXPIRES_IN_DEFAULT,
        ),
      });
      await this.events.record(work, {
        action: SECURITY_EVENT_ACTION.INVITATION_CREATED,
        actorId: SERVER_COMMAND_ACTOR,
        details: { email: result.invitation.email, roleId: role.id },
      });
      return result;
    });
    try {
      await this.mailer.sendInvitation(issued.invitation, issued.token);
    } catch (error) {
      await this.runner.run(async (work) => {
        await this.roster.lock(work);
        const invitation = await this.invitations.takeById(
          work,
          issued.invitation.id,
        );
        if (invitation && !invitation.acceptedAt && !invitation.revokedAt)
          await this.issuer.revoke(work, invitation, this.clock.now());
      });
      throw error;
    }
    return {
      command: 'admin:invite',
      status: 'invited',
      id: issued.invitation.id,
      email: issued.invitation.email,
    };
  }
}
