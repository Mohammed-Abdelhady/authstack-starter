import type { NativeApplicationConfiguration } from '../types/native-application.type';
import {
  parseApplicationPolicy,
  parseNativeSession,
} from './host-policy-config.util';

type ReservedNativePolicy = Pick<
  NativeApplicationConfiguration,
  | 'signUp'
  | 'requirePasskey'
  | 'audience'
  | 'session'
  | 'firstParty'
  | 'appleAppId'
  | 'androidPackage'
  | 'androidCertificates'
>;

/** Keep missing properties missing: the serialized application hashes live attempts. */
export function parseNativeApplicationPolicy(
  value: Record<string, unknown>,
  name: string,
): ReservedNativePolicy {
  const result: ReservedNativePolicy = parseApplicationPolicy(value, name);
  if (value.session !== undefined) {
    result.session = parseNativeSession(value.session, `${name}.session`);
  }
  if (value.firstParty !== undefined) {
    if (typeof value.firstParty !== 'boolean') {
      throw new Error(`${name}.firstParty must be boolean`);
    }
    result.firstParty = value.firstParty;
  }
  for (const key of ['appleAppId', 'androidPackage'] as const) {
    if (value[key] !== undefined) {
      result[key] = identifier(value[key], `${name}.${key}`);
    }
  }
  if (value.androidCertificates !== undefined) {
    if (
      !Array.isArray(value.androidCertificates) ||
      value.androidCertificates.length === 0
    ) {
      throw new Error(`${name}.androidCertificates must be a nonempty array`);
    }
    result.androidCertificates = value.androidCertificates.map(
      (entry: unknown) => identifier(entry, `${name}.androidCertificates`),
    );
  }
  return result;
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || /\s/u.test(value)) {
    throw new Error(`${name} must be a nonempty string without whitespace`);
  }
  return value;
}
