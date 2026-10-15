import { ACCOUNT_EN } from './account.en';
import { COMMON_EN } from './common.en';
import { NATIVE_EN } from './native.en';
import { ROLE_EN } from './role.en';
import { SESSIONS_EN } from './sessions.en';
import { SIGN_IN_EN } from './sign-in.en';

export const EN = {
  ...COMMON_EN,
  ...SIGN_IN_EN,
  ...ACCOUNT_EN,
  ...ROLE_EN,
  ...SESSIONS_EN,
  ...NATIVE_EN,
};

export type MessageKey = keyof typeof EN;
