import type { SupportedLocale } from '../../../common/constants/locales';

export interface RememberedDevices {
  keys: string[];
  day: string;
  count: number;
  firstAuthenticatedAt?: string;
  initialHandoffUsed?: boolean;
}

export interface DeviceNoticeAccount {
  email: string;
  locale: SupportedLocale;
  verified: boolean;
  signIns: number;
  devices: RememberedDevices | null;
}
