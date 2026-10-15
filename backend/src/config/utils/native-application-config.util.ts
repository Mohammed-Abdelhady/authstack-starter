import {
  ADMIN_CLIENT_ID,
  DEFAULT_API_AUDIENCE,
  NATIVE_APPLICATION_KNOWN_KEYS,
  NATIVE_APPLICATIONS_CONFIG_VARIABLE,
  NATIVE_CLIENT_ID_MAX_LENGTH,
  NATIVE_CLIENT_ID_PATTERN,
  NATIVE_SCOPE_PATTERN,
  WEB_CLIENT_ID,
} from '../../session/constants/client-ids';
import { isAcceptableRedirectUri } from '../../session/utils/oauth/redirect-uri.util';
import type { RedirectUriPolicy } from '../../session/utils/oauth/redirect-uri.util';
import type { NativeApplicationConfiguration } from '../types/native-application.type';
import { parseSignIn } from './native-sign-in-config.util';
import { parseNativeApplicationPolicy } from './native-application-policy.util';

const FIRST_PARTY_CLIENT_IDS = new Set([WEB_CLIENT_ID, ADMIN_CLIENT_ID]);
const KNOWN_ENTRY_KEYS = new Set<string>(NATIVE_APPLICATION_KNOWN_KEYS);

export function parseNativeApplications(
  raw: string | undefined,
  policy: RedirectUriPolicy = {},
): NativeApplicationConfiguration[] {
  if (raw === undefined || raw.trim() === '') {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `${NATIVE_APPLICATIONS_CONFIG_VARIABLE} must contain a valid JSON array.`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `${NATIVE_APPLICATIONS_CONFIG_VARIABLE} must contain a JSON array.`,
    );
  }

  const seenClientIds = new Set<string>();
  return parsed.map((entry: unknown, index: number) => {
    if (!isRecord(entry)) {
      throw entryError(index, undefined, 'must be an object');
    }
    for (const key of Object.keys(entry)) {
      if (!KNOWN_ENTRY_KEYS.has(key)) {
        throw entryError(index, undefined, `unknown key "${key}"`);
      }
    }

    const clientId = entry.clientId;
    if (!isNonEmptyString(clientId)) {
      throw entryError(index, clientId, 'clientId must be a non-empty string');
    }
    if (clientId.length > NATIVE_CLIENT_ID_MAX_LENGTH) {
      throw entryError(
        index,
        undefined,
        `clientId must be at most ${NATIVE_CLIENT_ID_MAX_LENGTH} characters`,
      );
    }
    if (!NATIVE_CLIENT_ID_PATTERN.test(clientId)) {
      throw entryError(
        index,
        undefined,
        'clientId may contain only letters, numbers, periods, underscores, hyphens, and tildes',
      );
    }
    if (FIRST_PARTY_CLIENT_IDS.has(clientId)) {
      throw entryError(
        index,
        clientId,
        'clientId is reserved for a first-party application',
      );
    }
    if (seenClientIds.has(clientId)) {
      throw entryError(index, clientId, 'clientId is duplicated');
    }
    seenClientIds.add(clientId);

    const displayName = entry.displayName;
    if (!isNonEmptyString(displayName)) {
      throw entryError(
        index,
        clientId,
        'displayName must be a non-empty string',
      );
    }
    if (displayName !== displayName.trim()) {
      throw entryError(
        index,
        clientId,
        'displayName must not have leading or trailing whitespace',
      );
    }

    const redirectUris = parseRedirectUris(
      entry.redirectUris,
      index,
      clientId,
      policy,
    );
    const allowedScopes = parseAllowedScopes(
      entry.allowedScopes,
      index,
      clientId,
    );

    const signIn = parseSignIn(entry.signIn, index, clientId);
    return {
      clientId,
      displayName,
      redirectUris,
      allowedScopes,
      ...(signIn ? { signIn } : {}),
      ...parseNativeApplicationPolicy(
        entry,
        `${NATIVE_APPLICATIONS_CONFIG_VARIABLE} ${clientId}`,
      ),
    };
  });
}

function parseRedirectUris(
  value: unknown,
  index: number,
  clientId: string,
  policy: RedirectUriPolicy = {},
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw entryError(
      index,
      clientId,
      'redirectUris must contain at least one address',
    );
  }

  const redirectUris: string[] = [];
  const seenRedirectUris = new Set<string>();
  for (const [redirectIndex, redirectUri] of value.entries()) {
    if (!isNonEmptyString(redirectUri)) {
      throw entryError(
        index,
        clientId,
        `redirectUris[${redirectIndex}] must be a non-empty string`,
      );
    }
    if (redirectUri !== redirectUri.trim() || /\s/.test(redirectUri)) {
      throw entryError(
        index,
        clientId,
        `redirectUris[${redirectIndex}] must not contain whitespace`,
      );
    }
    if (seenRedirectUris.has(redirectUri)) {
      throw entryError(
        index,
        clientId,
        `redirectUris[${redirectIndex}] duplicates an earlier address`,
      );
    }
    seenRedirectUris.add(redirectUri);
    if (!isAcceptableRedirectUri(redirectUri, policy)) {
      throw entryError(
        index,
        clientId,
        `redirectUris[${redirectIndex}] is not an acceptable redirect address`,
      );
    }
    redirectUris.push(redirectUri);
  }
  return redirectUris;
}

function parseAllowedScopes(
  value: unknown,
  index: number,
  clientId: string,
): string[] {
  if (value === undefined) {
    return [DEFAULT_API_AUDIENCE];
  }
  if (!Array.isArray(value)) {
    throw entryError(
      index,
      clientId,
      'allowedScopes must be an array of non-empty strings',
    );
  }
  if (value.length === 0) {
    throw entryError(
      index,
      clientId,
      'allowedScopes must contain at least one scope',
    );
  }

  const allowedScopes: string[] = [];
  const seenScopes = new Set<string>();
  for (const [scopeIndex, scope] of value.entries()) {
    if (!isNonEmptyString(scope)) {
      throw entryError(
        index,
        clientId,
        `allowedScopes[${scopeIndex}] must be a non-empty string`,
      );
    }
    if (!NATIVE_SCOPE_PATTERN.test(scope)) {
      throw entryError(
        index,
        clientId,
        `allowedScopes[${scopeIndex}] must be a valid RFC 6749 scope token`,
      );
    }
    if (seenScopes.has(scope)) {
      throw entryError(
        index,
        clientId,
        `allowedScopes[${scopeIndex}] duplicates an earlier scope`,
      );
    }
    seenScopes.add(scope);
    allowedScopes.push(scope);
  }
  // Scopes are not enforced on any route, so a narrower list would only look
  // like a restriction while the token kept the user's full permissions.
  if (allowedScopes.length !== 1 || allowedScopes[0] !== DEFAULT_API_AUDIENCE) {
    throw entryError(
      index,
      clientId,
      `allowedScopes must be exactly ["${DEFAULT_API_AUDIENCE}"]; it is the only scope and grants the user's full permissions`,
    );
  }
  return allowedScopes;
}

function entryError(index: number, clientId: unknown, reason: string): Error {
  const label =
    typeof clientId === 'string' && clientId.length > 0
      ? `entry ${JSON.stringify(clientId)}`
      : `entry at index ${index}`;
  return new Error(
    `${NATIVE_APPLICATIONS_CONFIG_VARIABLE} ${label}: ${reason}.`,
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
