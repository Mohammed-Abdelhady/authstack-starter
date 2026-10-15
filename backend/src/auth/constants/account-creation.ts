import { FIRST_FACTOR } from '../services/sessions/first-factor';

export const ACCOUNT_CREATION_METHOD = {
  PASSWORD: FIRST_FACTOR.PASSWORD,
  MAGIC_LINK: FIRST_FACTOR.MAGIC_LINK,
  PROVIDER: FIRST_FACTOR.PROVIDER,
  EMAIL_CODE: FIRST_FACTOR.EMAIL_CODE, // feature:email-code
  STAFF: 'staff',
} as const;
