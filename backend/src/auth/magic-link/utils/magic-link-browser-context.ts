import { ConfigService } from '@nestjs/config';
import type {
  BrowserApplicationConfiguration,
  BrowserApplicationId,
} from '../../../session/applications/types/browser-application';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../../session/constants/client-ids';
import { MAIL_LINK_PATHS, MAIL_NAME } from '../../../mail/constants/mail-names';
import { fillMailLink } from '../../../mail/links/mail-link-templates';
import { mailLink } from '../../../mail/links/mail-links';
import type { MailRecipient } from '../../../mail/types/mail-recipient.types';
import { createMagicLinkToken } from './magic-link-token.util';

const ADMIN_TOKEN_PREFIX = `${ADMIN_CLIENT_ID}.`;

export function createBrowserMagicLinkToken(
  clientId: BrowserApplicationId,
): string {
  const token = createMagicLinkToken();
  return clientId === ADMIN_CLIENT_ID ? `${ADMIN_TOKEN_PREFIX}${token}` : token;
}

/** Only call after the complete token hash matched an unexpired stored link. */
export function verifiedMagicLinkApplication(
  token: string,
): BrowserApplicationId {
  return token.startsWith(ADMIN_TOKEN_PREFIX) ? ADMIN_CLIENT_ID : WEB_CLIENT_ID;
}

export function browserMagicLinkUrl(
  config: ConfigService,
  application: BrowserApplicationConfiguration,
  recipient: MailRecipient,
  token: string,
): string {
  if (application.clientId === WEB_CLIENT_ID) {
    return mailLink(config, MAIL_NAME.MAGIC_LINK, recipient, { token });
  }
  const path = MAIL_LINK_PATHS[MAIL_NAME.MAGIC_LINK];
  return fillMailLink(
    `${application.returnBase.replace(/\/$/u, '')}${path}`,
    path,
    recipient.locale,
    { token },
  );
}
