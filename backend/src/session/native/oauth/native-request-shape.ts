export const TOKEN_REQUEST_FIELDS = [
  'install_id',
  'grant_type',
  'code',
  'redirect_uri',
  'client_id',
  'client_secret',
  'code_verifier',
  'refresh_token',
] as const;

export const REVOKE_REQUEST_FIELDS = [
  'token',
  'client_id',
  'client_secret',
] as const;

/**
 * The named fields of a token or revoke body. Undefined when the body is not
 * an object or a present field is not a string, so no caller trims a number.
 */
export function readStringFields<Field extends string>(
  body: unknown,
  fields: readonly Field[],
): Partial<Record<Field, string>> | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return undefined;
  }
  const read: Partial<Record<Field, string>> = {};
  for (const field of fields) {
    if (!Object.hasOwn(body, field)) {
      continue;
    }
    const value: unknown = Reflect.get(body, field);
    if (typeof value !== 'string') {
      return undefined;
    }
    read[field] = value;
  }
  return read;
}
