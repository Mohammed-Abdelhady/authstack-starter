import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminAccountStore } from '../admin/stores/admin-account.store';
import { AdminRosterStore } from '../admin/stores/admin-roster.store';
import { AdminEmailChangeService } from '../admin/services/users/admin-email-change.service';
import { ApplicationPolicyReader } from '../auth/contracts/application-policy';
import { EventRecorder } from '../auth/contracts/event-recorder';
// feature:passkeys:start
import {
  ENROLMENT_LINK_LIFETIME_MS,
  INVITATION_PURPOSE,
} from '../auth/invitations/constants/invitations';
import { InvitationIssuer } from '../auth/invitations/services/invitation-issuer';
import { InvitationMailer } from '../auth/invitations/services/invitation-mailer';
// feature:passkeys:end
import { PasswordSignInStore } from '../auth/stores/password-sign-in.store';
import { storedAddress } from '../common/persistence/stored-address';
import { UnitOfWorkRunner } from '../common/persistence/unit-of-work';
import { isAdminRole } from '../common/utils/role-hierarchy';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../session/constants/client-ids';
import { SECURITY_EVENT_ACTION } from '../session/constants/security-event-action';
import { SERVER_COMMAND_ACTOR } from './admin-command.constants';
import { AdminCommandError } from './admin-command-error';
import type { AdminRecoverOptions } from './types/admin-command';

@Injectable()
export class AdminRecoverService {
  constructor(
    private readonly runner: UnitOfWorkRunner,
    private readonly roster: AdminRosterStore,
    private readonly lookup: PasswordSignInStore,
    private readonly accounts: AdminAccountStore,
    private readonly policies: ApplicationPolicyReader,
    // feature:passkeys:start
    private readonly issuer: InvitationIssuer,
    private readonly mailer: InvitationMailer,
    // feature:passkeys:end
    private readonly emailChange: AdminEmailChangeService,
    private readonly events: EventRecorder,
    private readonly config: ConfigService,
  ) {}

  async recover(options: AdminRecoverOptions) {
    const found = await this.lookup.findActiveByAddress(options.email);
    if (!found || !isAdminRole(found.role))
      throw new AdminCommandError('not an administrator');
    const result = await this.runner.run(async (work) => {
      await this.roster.lock(work);
      const current = await this.accounts.takeAccountForChange(work, found.id);
      if (
        !current ||
        current.isDeleted ||
        !isAdminRole(current.role) ||
        storedAddress(current.email) !== storedAddress(options.email)
      ) {
        throw new AdminCommandError('not an administrator');
      }
      const clientId = this.config.get<string>('cors.adminUrl')
        ? ADMIN_CLIENT_ID
        : WEB_CLIENT_ID;
      const policy = await this.policies.requireEnabled(work, clientId);
      // feature:passkeys:start
      if (policy.requirePasskey === true) {
        const issued = await this.issuer.issue(work, {
          purpose: INVITATION_PURPOSE.ENROLMENT,
          userId: current.id,
          addressGeneration: current.addressGeneration,
          email: current.email,
          locale: current.locale,
          clientId,
          lifetimeMs: ENROLMENT_LINK_LIFETIME_MS,
        });
        await this.events.record(work, {
          action: SECURITY_EVENT_ACTION.ADMIN_RECOVERY_STARTED,
          actorId: SERVER_COMMAND_ACTOR,
          targetUserId: current.id,
          details: { email: current.email },
        });
        return {
          kind: 'enrolment' as const,
          issued,
          account: current,
          email: current.email,
        };
      }
      // feature:passkeys:end
      if (policy.requirePasskey)
        throw new AdminCommandError('Passkey recovery is unavailable');
      if (!options.newEmail)
        throw new AdminCommandError(
          'A console without passkeys signs in by mail, so recovery moves the account to a new address. --new-email is required',
        );
      const email = storedAddress(options.newEmail);
      if (email === storedAddress(current.email))
        throw new AdminCommandError('--new-email must be a different address');
      await this.emailChange.claimPendingIn(work, current, email);
      const account = await this.accounts.saveIdentity(work, current, {
        address: { email, addressGeneration: current.addressGeneration + 1 },
      });
      await this.events.record(work, {
        action: SECURITY_EVENT_ACTION.ADMIN_RECOVERY_STARTED,
        actorId: SERVER_COMMAND_ACTOR,
        targetUserId: current.id,
        details: { email },
      });
      return {
        kind: 'email_change' as const,
        account,
        email,
        previousEmail: current.email,
      };
    });
    // feature:passkeys:start
    if (result.kind === 'enrolment')
      await this.mailer.sendEnrolmentLink(
        result.issued.invitation,
        result.issued.token,
      );
    else {
      // feature:passkeys:end
      this.emailChange.notifyPreviousAddress({
        email: result.previousEmail,
        locale: result.account.locale,
      });
      await this.emailChange.sendServerCommandConfirmation(result.account);
    } // feature:passkeys
    return {
      command: 'admin:recover',
      status: result.kind,
      id: result.account.id,
      email: result.email,
    };
  }
}
