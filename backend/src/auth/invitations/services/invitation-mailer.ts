import { Injectable } from '@nestjs/common';
import { MailService } from '../../../mail/mail.service';
import { invitationLink } from '../../../mail/links/invitation-links';
import { BrowserApplications } from '../../../session/applications/browser-applications';
import { INVITATION_DAY_MS } from '../constants/invitations';
import { StoredInvitation } from '../types/invitation';
import { invitationClientId } from '../utils/invitation-application';

@Injectable()
export class InvitationMailer {
  constructor(
    private readonly mail: MailService,
    private readonly applications: BrowserApplications,
  ) {}

  sendInvitation(
    invitation: StoredInvitation,
    token: string,
    inviterName?: string,
  ): Promise<void> {
    return this.mail.sendInvitation(
      { email: invitation.email, locale: invitation.locale },
      this.link(invitation, token),
      this.days(invitation),
      inviterName,
    );
  }

  sendEnrolmentLink(
    invitation: StoredInvitation,
    token: string,
  ): Promise<void> {
    return this.mail.sendPasskeyReset(
      { email: invitation.email, locale: invitation.locale },
      this.link(invitation, token),
      this.days(invitation),
    );
  }

  private link(invitation: StoredInvitation, token: string): string {
    const application = this.applications.configuration(
      invitationClientId(invitation.clientId),
    );
    return invitationLink(application.origin, token, invitation.purpose);
  }

  private days(invitation: StoredInvitation): number {
    return Math.max(
      0,
      Math.floor(
        (invitation.expiresAt.getTime() - invitation.updatedAt.getTime()) /
          INVITATION_DAY_MS,
      ),
    );
  }
}
