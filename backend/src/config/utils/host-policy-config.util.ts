import { ROLE_AUDIENCE } from '../../host/types/host-role.type';
import {
  BROWSER_SIGN_IN_METHODS,
  SIGN_UP_POLICY,
} from '../constants/host-contracts';
import type {
  ApplicationPolicyConfiguration,
  BrowserSessionConfiguration,
  BrowserSignInConfiguration,
  NativeSessionConfiguration,
  SessionLifetimeConfiguration,
} from '../types/host-policy.type';

const POLICY_KEYS = ['signUp', 'requirePasskey', 'audience'];
const LIFETIME_KEYS = ['absoluteHours', 'idleMinutes'];

export function requireConfigObject(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function parseApplicationPolicy(
  value: Record<string, unknown>,
  name: string,
): ApplicationPolicyConfiguration {
  const { signUp, requirePasskey, audience } = value;
  if (
    signUp !== undefined &&
    signUp !== SIGN_UP_POLICY.OPEN &&
    signUp !== SIGN_UP_POLICY.CLOSED
  ) {
    throw new Error(`${name}.signUp must be open or closed`);
  }
  if (requirePasskey !== undefined && typeof requirePasskey !== 'boolean') {
    throw new Error(`${name}.requirePasskey must be boolean`);
  }
  const parsedAudience = Object.values(ROLE_AUDIENCE).find(
    (value) => value === audience,
  );
  if (audience !== undefined && parsedAudience === undefined) {
    throw new Error(
      `${name}.audience must be ${Object.values(ROLE_AUDIENCE).join(' or ')}`,
    );
  }
  return {
    ...(signUp === undefined ? {} : { signUp }),
    ...(requirePasskey === undefined ? {} : { requirePasskey }),
    ...(parsedAudience === undefined ? {} : { audience: parsedAudience }),
  };
}

export function parseBrowserSignIn(
  raw: string | undefined,
  name: string,
): BrowserSignInConfiguration | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${name} must contain valid JSON`);
  }
  const value = requireConfigObject(parsed, name);
  requireKeys(value, [...BROWSER_SIGN_IN_METHODS, ...POLICY_KEYS], name);
  const methods: BrowserSignInConfiguration = {};
  for (const method of BROWSER_SIGN_IN_METHODS) {
    const flag = value[method];
    if (flag === undefined) continue;
    if (typeof flag !== 'boolean') {
      throw new Error(`${name}.${method} must be boolean`);
    }
    methods[method] = flag;
  }
  return {
    ...methods,
    ...parseApplicationPolicy(value, name),
  };
}

function requireKeys(
  value: Record<string, unknown>,
  keys: string[],
  name: string,
): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error(`${name} contains an unknown key`);
  }
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function parseLifetime(
  value: unknown,
  name: string,
): SessionLifetimeConfiguration {
  const object = requireConfigObject(value, name);
  requireKeys(object, LIFETIME_KEYS, name);
  return {
    absoluteHours: positiveInteger(
      object.absoluteHours,
      `${name}.absoluteHours`,
    ),
    idleMinutes: positiveInteger(object.idleMinutes, `${name}.idleMinutes`),
  };
}

export function parseBrowserSession(
  raw: string | undefined,
  name: string,
): BrowserSessionConfiguration | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = requireConfigObject(JSON.parse(raw), name);
  requireKeys(value, [...LIFETIME_KEYS, 'cap'], name);
  const { cap, ...lifetime } = value;
  return {
    ...parseLifetime(lifetime, name),
    cap: positiveInteger(cap, `${name}.cap`),
  };
}

export function parseNativeSession(
  value: unknown,
  name: string,
): NativeSessionConfiguration {
  const object = requireConfigObject(value, name);
  requireKeys(object, ['bound', 'unbound'], name);
  return {
    bound: parseLifetime(object.bound, `${name}.bound`),
    unbound: parseLifetime(object.unbound, `${name}.unbound`),
  };
}
