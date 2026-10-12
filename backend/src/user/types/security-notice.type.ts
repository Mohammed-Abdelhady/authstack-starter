import type { SECURITY_NOTICE } from '../constants/security-notice.constants';

export type SecurityNotice =
  (typeof SECURITY_NOTICE)[keyof typeof SECURITY_NOTICE];
