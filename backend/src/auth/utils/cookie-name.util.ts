const HOST_PREFIX = '__Host-';

/**
 * The name a host-only cookie goes by. In production it carries `__Host-`,
 * which a browser accepts only with `Secure`, path `/` and no `Domain`, so no
 * other host of the domain can set or replace it. `__Secure-` would not do
 * that: a sibling host served over HTTPS may set such a cookie for the whole
 * domain. Outside production the plain name is kept, because a prefixed cookie
 * is refused over http.
 */
export function hostCookieName(
  nodeEnv: string | undefined,
  name: string,
): string {
  return nodeEnv === 'production' ? `${HOST_PREFIX}${name}` : name;
}
