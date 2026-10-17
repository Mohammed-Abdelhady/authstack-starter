import { Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { AdminAccountStore } from '../../../admin/stores/admin-account.store';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { Clock } from '../../../common/services/clock';
import { CSRF_HEADER } from '../../../session/constants/browser-proof';
import { SECURITY_EVENT_ACTION } from '../../../session/constants/security-event-action';
import { SessionIssuanceService } from '../../../session/services/session-issuance.service';
import { hashToken } from '../../../session/utils/hashing/token-hash';
import { ApplicationPolicyReader } from '../../contracts/application-policy';
import { EventRecorder } from '../../contracts/event-recorder';
import { SessionCookieService } from '../../services/sessions/session-cookie.service';
import {
  INVITATION_MAX_TOKEN_LENGTH,
  INVITATION_PURPOSE,
} from '../constants/invitations';
import { InvitationStore } from '../stores/invitation.store';
import { InvitationAcceptance } from '../types/invitation-acceptance';
import { invitationClientId } from '../utils/invitation-application';
import {
  invalidInvitation,
  requireEnrolmentAccount,
  requireOpenInvitation,
} from '../utils/invitation-validity';
import { InvitationAccountCreator } from './invitation-account-creator';

@Injectable()
export class InvitationAcceptService {
  constructor(
    private readonly runner: UnitOfWorkRunner,
    private readonly invitations: InvitationStore,
    private readonly creator: InvitationAccountCreator,
    private readonly accounts: AdminAccountStore,
    private readonly policy: ApplicationPolicyReader,
    private readonly sessions: SessionIssuanceService,
    private readonly cookies: SessionCookieService,
    private readonly events: EventRecorder,
    private readonly clock: Clock,
  ) {}

  async accept(
    token: string,
    request: Request,
    response: Response,
  ): Promise<InvitationAcceptance> {
    if (!token || token.length > INVITATION_MAX_TOKEN_LENGTH)
      throw invalidInvitation();
    const result = await this.runner.run(async (work) => {
      const found = await this.invitations.takeByTokenHash(
        work,
        hashToken(token),
      );
      const now = this.clock.now();
      const invitation = requireOpenInvitation(found, now);
      const clientId = invitationClientId(invitation.clientId);
      const policy = await this.policy.requireEnabled(work, clientId);
      const isEnrolmentLink =
        invitation.purpose === INVITATION_PURPOSE.ENROLMENT;
      const user = isEnrolmentLink
        ? requireEnrolmentAccount(
            invitation,
            invitation.userId
              ? await this.accounts.takeAccountForChange(
                  work,
                  invitation.userId,
                )
              : null,
          )
        : await this.creator.create(work, invitation, now);
      if (!user || user.isDeleted) throw invalidInvitation();
      await this.invitations.markAccepted(work, invitation.id, now);
      if (!isEnrolmentLink) {
        await this.events.record(work, {
          action: SECURITY_EVENT_ACTION.INVITATION_ACCEPTED,
          actorId: user.id,
          targetUserId: user.id,
          clientId,
        });
      }
      const enrolment = isEnrolmentLink || policy.requirePasskey === true;
      const agent = request.headers['user-agent'] || 'Unknown';
      const ip = request.ip || '127.0.0.1';
      const issued = enrolment
        ? await this.sessions.createEnrolmentSessionIn(
            work,
            user.id,
            agent,
            ip,
            clientId,
          )
        : await this.sessions.createBrowserSessionIn(
            work,
            user.id,
            agent,
            ip,
            clientId,
            { authenticationMethods: [], userVerified: false },
          );
      return {
        clientId,
        issued,
        acceptance: {
          purpose: invitation.purpose,
          enrolment,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          },
        },
      };
    });
    this.cookies.set(response, result.issued.sessionToken, result.clientId);
    response.setHeader(CSRF_HEADER, result.issued.csrfToken);
    return result.acceptance;
  }
}
