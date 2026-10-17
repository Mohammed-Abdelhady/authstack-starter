import type { RememberedDevices } from './types/device-notice';
import { AUTHORIZATION_CODE_LIFETIME_MS } from '../constants/session-policy';

export const REMEMBERED_DEVICE_LIMIT = 20;
export const DAILY_DEVICE_NOTICE_LIMIT = 3;

export function rememberDevice(input: {
  devices: RememberedDevices | null;
  key: string;
  at: Date;
  signIns: number;
  authenticatedAt?: Date;
}): { devices: RememberedDevices; notify: boolean } {
  const day = input.at.toISOString().slice(0, 10);
  const previous = input.devices;
  const known = previous?.keys.includes(input.key) ?? false;
  const count = previous?.day === day ? previous.count : 0;
  const firstAuthenticatedAt =
    previous?.firstAuthenticatedAt ??
    (!previous ? (input.authenticatedAt ?? input.at).toISOString() : undefined);
  const authenticationAge = input.authenticatedAt
    ? input.at.getTime() - input.authenticatedAt.getTime()
    : -1;
  const initialAuthentication =
    input.authenticatedAt !== undefined &&
    !previous?.initialHandoffUsed &&
    authenticationAge >= 0 &&
    authenticationAge < AUTHORIZATION_CODE_LIFETIME_MS &&
    firstAuthenticatedAt === input.authenticatedAt.toISOString();
  const notify =
    Boolean(previous) &&
    !known &&
    !initialAuthentication &&
    input.signIns > 1 &&
    count < DAILY_DEVICE_NOTICE_LIMIT;
  const keys = [
    ...(previous?.keys ?? []).filter((key) => key !== input.key),
    input.key,
  ].slice(-REMEMBERED_DEVICE_LIMIT);
  return {
    devices: {
      keys,
      day,
      count: count + Number(notify),
      ...(firstAuthenticatedAt ? { firstAuthenticatedAt } : {}),
      ...(previous?.initialHandoffUsed || initialAuthentication
        ? { initialHandoffUsed: true }
        : {}),
    },
    notify,
  };
}
