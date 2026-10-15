import { ACCOUNT_AR } from './account.ar';
import { COMMON_AR } from './common.ar';
import type { MessageKey } from './en';
import { NATIVE_AR } from './native.ar';
import { ROLE_AR } from './role.ar';
import { SESSIONS_AR } from './sessions.ar';
import { SIGN_IN_AR } from './sign-in.ar';
import { EMAIL_AR } from './email.ar';

export const AR: Record<MessageKey, string> = {
  ...COMMON_AR,
  ...SIGN_IN_AR,
  ...ACCOUNT_AR,
  ...ROLE_AR,
  ...SESSIONS_AR,
  ...NATIVE_AR,
  ...EMAIL_AR,
};
