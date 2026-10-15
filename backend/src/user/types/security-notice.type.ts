import type { DeviceParts } from '@app/sdk';
import type { SECURITY_NOTICE } from '../constants/security-notice.constants';

export type SecurityNotice =
  (typeof SECURITY_NOTICE)[keyof typeof SECURITY_NOTICE];

/** What a notice says happened, fixed when the change committed. */
export interface SecurityNoticeFacts {
  at: Date;
  /** The device that made the change, from its user agent. */
  device?: DeviceParts;
}
