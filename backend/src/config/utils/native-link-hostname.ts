/** A raw Host header, without trusting forwarded-host headers. */
export function requestHostname(value: string | undefined): string | undefined {
  if (!value || /[\s/@?#\\]/u.test(value)) return undefined;
  try {
    const url = new URL(`http://${value}`);
    if (url.username || url.password || url.pathname !== '/') return undefined;
    return url.hostname.toLowerCase().replace(/\.$/u, '');
  } catch {
    return undefined;
  }
}

export function nativeLinkHostname(value: string): string {
  const host = value.trim();
  const hostname = requestHostname(host);
  if (!hostname || host.includes(':')) {
    throw new Error(
      'AUTH_NATIVE_LINK_HOST must be a hostname without a scheme, port or path',
    );
  }
  return hostname;
}
