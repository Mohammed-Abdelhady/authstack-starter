import { HTTP_STATUS_OK } from './constants';
import { malformedResponse, unwrapEnvelope, unwrapEnvelopeBody, type JsonObject } from './envelope';
import { requireArray, requireObject } from './shapes';
import type { TransportResponse } from './transport';
import type { AuthMethods } from './types';

/** Switches a server built without the method leaves out. */
const OPTIONAL_SWITCHES = ['magicLink', 'emailCode', 'twoFactor', 'passkeys'] as const;

const PROVIDERS_KEY = 'oauth';

function requireBoolean(value: unknown, name: string, status: number): boolean {
  if (typeof value !== 'boolean') {
    throw malformedResponse(status, `The response is malformed: ${name} is not a boolean`);
  }
  return value;
}

/**
 * Checks `data.methods` and fills in what the server left out as off.
 * `password` is the one switch every server sends. The spread carries the
 * rest, so nothing here names a key an optional feature owns as a type member.
 */
function toAuthMethods(data: unknown, status: number): AuthMethods {
  const response: { methods?: unknown } = requireObject(data, 'data', status);
  const methods: JsonObject & { password?: unknown } = requireObject(
    response.methods,
    'methods',
    status,
  );
  const password = requireBoolean(methods.password, 'methods.password', status);
  for (const key of OPTIONAL_SWITCHES) {
    if (key in methods) requireBoolean(methods[key], `methods.${key}`, status);
  }
  if (PROVIDERS_KEY in methods) {
    requireArray(methods[PROVIDERS_KEY], `methods.${PROVIDERS_KEY}`, status);
  }

  return {
    magicLink: false,
    emailCode: false,
    twoFactor: false,
    passkeys: false,
    oauth: [],
    ...methods,
    password,
  };
}

/** The reply of GET /api/auth/methods, checked and normalised. */
export function unwrapAuthMethods(response: TransportResponse): AuthMethods {
  return toAuthMethods(unwrapEnvelope<unknown>(response), response.status);
}

/** The same for a body whose response already passed as successful. */
export function unwrapAuthMethodsBody(body: unknown): AuthMethods {
  return toAuthMethods(unwrapEnvelopeBody<unknown>(body), HTTP_STATUS_OK);
}
