import { ConfigService } from '@nestjs/config';
import { MS_PER_MINUTE } from '../../mail/constants/mail.constants';
import type { ApplicationPolicyValues } from '../../session/applications/application-registry.store';
import type { BrowserApplicationId } from '../../session/applications/types/browser-application';
import { ADMIN_CLIENT_ID } from '../../session/constants/client-ids';
import {
  ADMIN_ABSOLUTE_LIFETIME_MS,
  ADMIN_IDLE_LIFETIME_MS,
  MAX_ADMIN_SESSIONS_PER_USER,
  NATIVE_ABSOLUTE_LIFETIME_MS,
  NATIVE_IDLE_LIFETIME_MS,
} from '../../session/constants/session-policy';
import type { EnvironmentVariables } from '../env.schema';
import type { BrowserSessionConfiguration } from '../types/host-policy.type';
import {
  parseBrowserSession,
  parseNativeSession,
} from './host-policy-config.util';
import { parseNativeApplications } from './native-application-config.util';

const MS_PER_HOUR = MS_PER_MINUTE * 60;
const MAX_STORED_SESSION_CAP = 2_147_483_647;

function milliseconds(value: number, unit: number, name: string): number {
  const result = value * unit;
  if (
    !Number.isSafeInteger(result) ||
    result <= 0 ||
    !Number.isFinite(new Date(Date.now() + result).getTime())
  ) {
    throw new Error(`${name} must convert to a safe positive session duration`);
  }
  return result;
}

function lifetime(
  value: { absoluteHours: number; idleMinutes: number },
  setting: string,
): ApplicationPolicyValues {
  return {
    absoluteLifetimeMs: milliseconds(
      value.absoluteHours,
      MS_PER_HOUR,
      `${setting}.absoluteHours`,
    ),
    idleLifetimeMs: milliseconds(
      value.idleMinutes,
      MS_PER_MINUTE,
      `${setting}.idleMinutes`,
    ),
  };
}

function browserPolicy(
  session: BrowserSessionConfiguration | undefined,
  setting: string,
) {
  if (session === undefined) return undefined;
  const policy = lifetime(session, setting);
  const cap = session.cap;
  if (!Number.isSafeInteger(cap) || cap <= 0 || cap > MAX_STORED_SESSION_CAP) {
    throw new Error(`${setting}.cap must be a positive stored integer`);
  }
  if (
    setting === 'AUTH_ADMIN_SESSION' &&
    (policy.absoluteLifetimeMs > ADMIN_ABSOLUTE_LIFETIME_MS ||
      policy.idleLifetimeMs > ADMIN_IDLE_LIFETIME_MS ||
      cap > MAX_ADMIN_SESSIONS_PER_USER)
  ) {
    throw new Error(
      `${setting} cannot exceed the admin limits of ${ADMIN_ABSOLUTE_LIFETIME_MS / MS_PER_HOUR} absolute hours, ${ADMIN_IDLE_LIFETIME_MS / MS_PER_MINUTE} idle minutes and ${MAX_ADMIN_SESSIONS_PER_USER} sessions`,
    );
  }
  return { policy, sessionCap: cap };
}

export function readBrowserSessionLimits(
  config: ConfigService,
  clientId: BrowserApplicationId,
) {
  const setting =
    clientId === ADMIN_CLIENT_ID ? 'AUTH_ADMIN_SESSION' : 'AUTH_WEB_SESSION';
  const configured = config.get<BrowserSessionConfiguration>(
    `auth.${clientId}.session`,
  );
  const parsed =
    configured === undefined
      ? undefined
      : parseBrowserSession(JSON.stringify(configured), setting);
  return browserPolicy(parsed, setting);
}

export function nativeSessionPolicy(
  session: unknown,
  setting: string,
): ApplicationPolicyValues {
  if (session === undefined) {
    return {
      absoluteLifetimeMs: NATIVE_ABSOLUTE_LIFETIME_MS,
      idleLifetimeMs: NATIVE_IDLE_LIFETIME_MS,
    };
  }
  const parsed = parseNativeSession(session, setting);
  const bound = lifetime(parsed.bound, `${setting}.bound`);
  const unbound = lifetime(parsed.unbound, `${setting}.unbound`);
  for (const field of ['absoluteHours', 'idleMinutes'] as const) {
    if (parsed.unbound[field] > parsed.bound[field]) {
      throw new Error(
        `${setting}.unbound.${field} cannot exceed bound.${field}; reduce unbound.${field} or increase bound.${field}`,
      );
    }
  }
  return {
    ...bound,
    unboundAbsoluteLifetimeMs: unbound.absoluteLifetimeMs,
    unboundIdleLifetimeMs: unbound.idleLifetimeMs,
  };
}

export function validateSessionLimitConfiguration(
  config: EnvironmentVariables,
): void {
  for (const setting of ['AUTH_WEB_SESSION', 'AUTH_ADMIN_SESSION'] as const) {
    browserPolicy(parseBrowserSession(config[setting], setting), setting);
  }
  if (!config.AUTH_NATIVE_ENABLED) return;
  const applications = parseNativeApplications(
    config.AUTH_NATIVE_APPLICATIONS,
    {
      nodeEnv: config.NODE_ENV,
      allowCustomScheme: config.AUTH_NATIVE_ALLOW_CUSTOM_SCHEME,
    },
  );
  for (const application of applications) {
    nativeSessionPolicy(
      application.session,
      `AUTH_NATIVE_APPLICATIONS entry ${JSON.stringify(application.clientId)}.session`,
    );
  }
}
