/** Each native provider mode and the credential kinds that answer it. */
const LINKABLE_CREDENTIALS: Readonly<Record<string, readonly string[]>> = {
  googleIdentityToken: ['googleIdentityToken'],
  appleIdentityTokenAndCode: ['appleIdentityTokenAndCode'],
  // A Facebook access token carries no nonce, so only the limited token links.
  facebook: ['facebookLimitedToken'],
};

/** The credential kinds that can link through a mode; none for `system`. */
export function linkableCredentials(mode: string): readonly string[] {
  return Object.hasOwn(LINKABLE_CREDENTIALS, mode)
    ? (LINKABLE_CREDENTIALS[mode] ?? [])
    : [];
}
