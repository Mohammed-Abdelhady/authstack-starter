import type { RoleAudience } from '../../host/types/host-role.type';
import type { SupportedLocale } from '../../common/constants/locales';

/** Who a mail goes to, and in which language it is written. */
export interface MailRecipient {
  email: string;
  locale: SupportedLocale;
  audience?: RoleAudience;
}
