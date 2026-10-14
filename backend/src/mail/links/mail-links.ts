import { ConfigService } from '@nestjs/config';
import { buildClientUrl } from '../../common/utils/client-url.util';
import { LinkedMailName, MAIL_LINK_PATHS } from '../constants/mail-names';
import type { MailRecipient } from '../types/mail-recipient.types';
import { fillMailLink, MailLinkTemplates } from './mail-link-templates';

/** Who a link set is for. Each audience has its own whole set of templates. */
export const MAIL_AUDIENCE = {
  CUSTOMER: 'customer',
  STAFF: 'staff',
} as const;

export type MailAudience = (typeof MAIL_AUDIENCE)[keyof typeof MAIL_AUDIENCE];

/** The settings that hold each audience's templates. */
export const MAIL_LINK_SETTING: Readonly<Record<MailAudience, string>> = {
  [MAIL_AUDIENCE.CUSTOMER]: 'MAIL_LINKS_CUSTOMER',
  [MAIL_AUDIENCE.STAFF]: 'MAIL_LINKS_STAFF',
};

/** `mail.links` in the configuration: an audience without templates uses `CLIENT_URL`. */
export type MailLinkSettings = Partial<Record<MailAudience, MailLinkTemplates>>;

/**
 * The audience whose links a recipient gets. Accounts carry no audience yet,
 * so every recipient is a customer, which with both settings absent is the
 * link every mail had before templates existed. This is the one place the
 * choice is made.
 */
export function mailAudienceOf(_recipient: MailRecipient): MailAudience {
  return MAIL_AUDIENCE.CUSTOMER;
}

/**
 * The link a mail carries for an audience, in the recipient's language. With
 * no templates for the audience it is `CLIENT_URL` plus the mail's fixed path,
 * exactly as before templates existed.
 */
export function mailLinkFor(
  config: ConfigService,
  mail: LinkedMailName,
  audience: MailAudience,
  recipient: MailRecipient,
  params: Readonly<Record<string, string>> = {},
): string {
  const templates = config.get<MailLinkSettings>('mail.links')?.[audience];
  const path = MAIL_LINK_PATHS[mail];
  if (templates === undefined) {
    return buildClientUrl(config, path, { ...params });
  }
  return fillMailLink(templates[mail], path, recipient.locale, params);
}

/** The link a mail carries for this recipient, through their audience. */
export function mailLink(
  config: ConfigService,
  mail: LinkedMailName,
  recipient: MailRecipient,
  params: Readonly<Record<string, string>> = {},
): string {
  const audience = mailAudienceOf(recipient);
  return mailLinkFor(config, mail, audience, recipient, params);
}
