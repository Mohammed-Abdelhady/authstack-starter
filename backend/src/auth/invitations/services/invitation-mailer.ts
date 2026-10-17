import { ConfigService } from '@nestjs/config';
import { MAIL_NAME } from '../../../mail/constants/mail-names';
import {
  MAIL_AUDIENCE,
  mailLinkFor,
  type MailLinkSettings,
} from '../../../mail/links/mail-links';
import { ADMIN_CLIENT_ID } from '../../../session/constants/client-ids';
import { isAdminRole } from '../../../common/utils/role-hierarchy';
import { ROLE_AUDIENCE } from '../../../host/types/host-role.type';
import { INVITATION_PURPOSE } from '../constants/invitations';
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
    private readonly config: ConfigService,
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
    const recipientAudience =
      invitation.audience ?? application.signIn?.audience;
    const staff =
      recipientAudience === ROLE_AUDIENCE.STAFF ||
      (recipientAudience === undefined &&
        (invitation.clientId === ADMIN_CLIENT_ID ||
          isAdminRole(invitation.roleSlug ?? '')));
    const audience = staff ? MAIL_AUDIENCE.STAFF : MAIL_AUDIENCE.CUSTOMER;
    const name =
      invitation.purpose === INVITATION_PURPOSE.ENROLMENT
        ? MAIL_NAME.ENROLMENT
        : MAIL_NAME.INVITATION;
    let base = mailLinkFor(this.config, name, audience, invitation);
    if (!this.config.get<MailLinkSettings>('mail.links')?.[audience]?.[name]) {
      const url = new URL(base);
      base = new URL(url.pathname + url.search, application.origin).toString();
    }
    return invitationLink(base, token, invitation.purpose);
  }

  private days(invitation: StoredInvitation): number {
    return Math.max(
      1,
      Math.ceil(
        (invitation.expiresAt.getTime() - invitation.updatedAt.getTime()) /
          INVITATION_DAY_MS,
      ),
    );
  }
}
