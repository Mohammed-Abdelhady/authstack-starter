import { DISALLOWED_REDIRECT_URI_SCHEMES, MAX_CALLBACK_LENGTH } from '../constants';
import type { AuthConfiguration, InvalidCallbackReason } from '../types/auth';

export interface UriParts {
  scheme: string;
  host: string;
  port: string;
  path: string;
  query: string;
  hasAuthority: boolean;
  hasFragment: boolean;
  hasUserInfo: boolean;
}

export type CallbackResult =
  | { kind: 'code'; code: string; state: string }
  | { kind: 'error'; error: string; state: string }
  | { kind: 'invalid'; reason: InvalidCallbackReason };

export function validateConfiguration(configuration: AuthConfiguration): AuthConfiguration {
  const base = parseUri(configuration.serverBaseAddress);
  const redirect = parseUri(configuration.redirectUri);
  if (
    !base ||
    !redirect ||
    (base.scheme !== 'https' && base.scheme !== 'http') ||
    !base.host ||
    !isOriginPath(base.path) ||
    base.hasQuery ||
    base.hasFragment ||
    base.hasUserInfo ||
    redirect.hasQuery ||
    redirect.hasFragment ||
    redirect.hasUserInfo ||
    DISALLOWED_REDIRECT_URI_SCHEMES.has(redirect.scheme) ||
    !isNonEmpty(configuration.environment) ||
    !isNonEmpty(configuration.clientId) ||
    configuration.scopes.length === 0 ||
    configuration.scopes.some((scope) => !isNonEmpty(scope)) ||
    new Set(configuration.scopes).size !== configuration.scopes.length
  ) {
    throw new TypeError('Invalid native auth configuration');
  }
  if (!isServerNormalizedRedirect(configuration.redirectUri, redirect)) {
    throw new TypeError('redirectUri must be accepted unchanged by the server URL parser');
  }
  assertHttpIsLoopback(base.scheme, base.host, 'serverBaseAddress');
  assertHttpIsLoopback(redirect.scheme, redirect.host, 'redirectUri');
  if (serializeUri(redirect) !== configuration.redirectUri) {
    throw new TypeError('redirectUri must be accepted unchanged by the server URL parser');
  }
  return {
    ...configuration,
    serverBaseAddress: serializeUri(base).replace(/\/+$/, ''),
    scopes: [...configuration.scopes],
  };
}

function isServerNormalizedRedirect(address: string, uri: UriParts): boolean {
  if (!/^[\u0021-\u007e]+$/.test(address) || /["<>`{}]/.test(address)) return false;
  if (serializeUri(uri) !== address) return false;
  if (uri.scheme === 'http' || uri.scheme === 'https') {
    if (!uri.hasAuthority || !uri.host || !uri.path.startsWith('/') || !uri.path) return false;
    if (!isCanonicalWebHost(uri.host)) return false;
  } else if (uri.hasAuthority) {
    if (!uri.host && !uri.path.startsWith('/')) return false;
    if (uri.host && !isCanonicalCustomHost(uri.host)) return false;
  }
  if ((uri.hasAuthority || uri.path.startsWith('/')) && hasNormalizedDotSegment(uri.path))
    return false;
  if ((uri.hasAuthority || uri.path.startsWith('/')) && uri.path.includes('^')) return false;
  return true;
}

function isCanonicalCustomHost(host: string): boolean {
  return host.startsWith('[') ? isCanonicalIpv6Host(host) : /^[a-z0-9._~-]+$/i.test(host);
}

function isCanonicalWebHost(host: string): boolean {
  if (host.startsWith('[')) return isCanonicalIpv6Host(host);
  if (!/^[a-z0-9._~-]+$/i.test(host)) return false;
  const withoutTrailingDot = host.endsWith('.') ? host.slice(0, -1) : host;
  const finalLabel = withoutTrailingDot.split('.').at(-1) ?? '';
  if (/^(?:0x[0-9a-f]*|[0-9]+)$/i.test(finalLabel)) {
    if (host.endsWith('.')) return false;
    return isCanonicalIpv4Host(host);
  }
  return true;
}

function isCanonicalIpv4Host(host: string): boolean {
  const octets = host.split('.');
  return (
    octets.length === 4 &&
    octets.every((octet) => {
      if (!/^(0|[1-9][0-9]{0,2})$/.test(octet)) return false;
      const value = Number.parseInt(octet, 10);
      return value <= 255;
    })
  );
}

function isCanonicalIpv6Host(host: string): boolean {
  const address = host.slice(1, -1);
  const canonical = canonicalIpv6(address);
  return canonical !== undefined && canonical === address;
}

function canonicalIpv6(address: string): string | undefined {
  if (!address || address !== address.toLowerCase() || address.includes('.')) return undefined;
  const separator = address.indexOf('::');
  if (separator !== address.lastIndexOf('::')) return undefined;
  const leftPart = separator < 0 ? address : address.slice(0, separator);
  const rightPart = separator < 0 ? '' : address.slice(separator + 2);
  const left = leftPart ? leftPart.split(':') : [];
  const right = rightPart ? rightPart.split(':') : [];
  const groups = [...left, ...right];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined;
  const missing = 8 - groups.length;
  if ((separator < 0 && missing !== 0) || (separator >= 0 && missing < 1)) return undefined;
  const expanded = [...left, ...Array.from({ length: missing }, () => '0'), ...right].map((group) =>
    Number.parseInt(group, 16),
  );
  let bestStart = -1;
  let bestLength = 1;
  for (let index = 0; index < expanded.length;) {
    if (expanded[index] !== 0) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < expanded.length && expanded[end] === 0) end += 1;
    if (end - index > bestLength) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  if (bestStart < 0) return expanded.map((group) => group.toString(16)).join(':');
  const before = expanded
    .slice(0, bestStart)
    .map((group) => group.toString(16))
    .join(':');
  const after = expanded
    .slice(bestStart + bestLength)
    .map((group) => group.toString(16))
    .join(':');
  return `${before}::${after}`;
}

function hasNormalizedDotSegment(path: string): boolean {
  return path.split('/').some((segment) => {
    const normalizedDots = segment.replace(/%2e/gi, '.');
    return normalizedDots === '.' || normalizedDots === '..';
  });
}

export function parseCallback(address: string, expected: UriParts): CallbackResult {
  if (address.length > MAX_CALLBACK_LENGTH) return { kind: 'invalid', reason: 'tooLong' };
  const parsed = parseUri(address);
  if (!parsed) return { kind: 'invalid', reason: 'malformed' };
  if (parsed.hasUserInfo) return { kind: 'invalid', reason: 'userInfo' };
  if (parsed.hasFragment) return { kind: 'invalid', reason: 'fragment' };
  if (!sameDestination(parsed, expected)) return { kind: 'invalid', reason: 'destinationMismatch' };
  const entries = readQuery(parsed.query);
  if (!entries) return { kind: 'invalid', reason: 'malformed' };
  if (entries.kind === 'repeated') return { kind: 'invalid', reason: 'repeatedParameter' };

  const code = entries.values.get('code');
  const error = entries.values.get('error');
  const state = entries.values.get('state');
  if (entries.values.size !== 2 || !state || (!code && !error)) {
    return { kind: 'invalid', reason: 'invalidParameters' };
  }
  return code === undefined
    ? { kind: 'error', error: error ?? '', state }
    : { kind: 'code', code, state };
}

export function matchesRedirectDestination(address: string, returnAddress: string): boolean {
  const actual = parseUri(address);
  const expected = parseUri(returnAddress);
  return Boolean(actual && expected && sameDestination(actual, expected));
}

export function parseUri(value: string): (UriParts & { hasQuery: boolean }) | undefined {
  if (/[\u0020\\]/.test(value) || hasControlCharacter(value)) return undefined;
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):(?:(\/\/)([^/?#]*))?([^?#]*)(\?[^#]*)?(#.*)?$/.exec(
    value,
  );
  if (!match) return undefined;
  const [, rawScheme] = match;
  if (rawScheme === undefined) return undefined;
  const hasAuthority = match[2] !== undefined;
  const scheme = rawScheme.toLowerCase();
  const authority = match[3] ?? '';
  const userInfoEnd = authority.lastIndexOf('@');
  const hasUserInfo = userInfoEnd >= 0;
  const hostPort =
    !hasAuthority || (authority === '' && !/^https?$/i.test(rawScheme))
      ? { host: '', port: '' }
      : parseHostPort(hasUserInfo ? authority.slice(userInfoEnd + 1) : authority, scheme);
  if (!hostPort) return undefined;
  return {
    scheme,
    host: hostPort.host,
    port: hostPort.port,
    path: match[4] ?? '',
    query: match[5]?.slice(1) ?? '',
    hasQuery: match[5] !== undefined,
    hasFragment: match[6] !== undefined,
    hasUserInfo,
    hasAuthority,
  };
}

function parseHostPort(
  authority: string,
  scheme: string,
): { host: string; port: string } | undefined {
  if (!authority || authority.includes('@') || authority.includes('%')) return undefined;
  if (authority.startsWith('[')) {
    const closingBracket = authority.indexOf(']');
    if (closingBracket < 0) return undefined;
    const rawHost = authority.slice(0, closingBracket + 1);
    const host = isWebScheme(scheme) ? rawHost.toLowerCase() : rawHost;
    if (!isCanonicalIpv6Host(host)) return undefined;
    const suffix = authority.slice(closingBracket + 1);
    if (!suffix) return { host: host.toLowerCase(), port: '' };
    if (!/^:\d+$/.test(suffix)) return undefined;
    const port = parsePort(suffix.slice(1), scheme);
    return port === undefined ? undefined : { host: host.toLowerCase(), port };
  }
  const colon = authority.lastIndexOf(':');
  if (colon < 0) return { host: normalizedHost(authority, scheme), port: '' };
  if (authority.indexOf(':') !== colon) return undefined;
  const host = authority.slice(0, colon);
  const port = authority.slice(colon + 1);
  if (!host || !/^\d+$/.test(port)) return undefined;
  const parsedPort = parsePort(port, scheme);
  return parsedPort === undefined
    ? undefined
    : { host: normalizedHost(host, scheme), port: parsedPort };
}

function normalizedHost(host: string, scheme: string): string {
  return isWebScheme(scheme) ? host.toLowerCase() : host;
}

function isWebScheme(scheme: string): boolean {
  return scheme === 'http' || scheme === 'https';
}

function parsePort(value: string, scheme: string): string | undefined {
  const port = Number.parseInt(value, 10);
  const minimum = isWebScheme(scheme) ? 1 : 0;
  if (!/^\d+$/.test(value) || port < minimum || port > 65_535) return undefined;
  return String(port);
}

function readQuery(
  query: string,
): { kind: 'values'; values: Map<string, string> } | { kind: 'repeated' } | undefined {
  const values = new Map<string, string>();
  if (!query) return { kind: 'values', values };
  try {
    for (const pair of query.split('&')) {
      const separator = pair.indexOf('=');
      const key = decodeQueryPart(separator < 0 ? pair : pair.slice(0, separator));
      const value = decodeQueryPart(separator < 0 ? '' : pair.slice(separator + 1));
      if (values.has(key)) return { kind: 'repeated' };
      values.set(key, value);
    }
  } catch {
    return undefined;
  }
  return { kind: 'values', values };
}

function decodeQueryPart(value: string): string {
  return decodeURIComponent(value.replace(/\+/g, ' '));
}

function sameDestination(left: UriParts, right: UriParts): boolean {
  return (
    left.scheme === right.scheme &&
    left.host === right.host &&
    left.port === right.port &&
    left.path === right.path &&
    left.hasAuthority === right.hasAuthority
  );
}

function serializeUri(uri: UriParts): string {
  const defaultPort =
    (uri.scheme === 'https' && uri.port === '443') || (uri.scheme === 'http' && uri.port === '80');
  const port = uri.port && !defaultPort ? `:${uri.port}` : '';
  const authority = uri.hasAuthority ? `//${uri.host}${port}` : '';
  return `${uri.scheme}:${authority}${uri.path}`;
}

function isOriginPath(path: string): boolean {
  return path === '/' || path === '';
}

function assertHttpIsLoopback(scheme: string, host: string, field: string): void {
  if (scheme !== 'http' || isLoopbackHost(host)) return;
  throw new TypeError(`${field} may use HTTP only with a loopback host`);
}

function isLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost') || host === '[::1]') return true;
  const octets = host.split('.');
  if (octets.length !== 4 || octets[0] !== '127') return false;
  return octets.every((octet) => {
    const value = Number.parseInt(octet, 10);
    return /^\d{1,3}$/.test(octet) && value <= 255 && String(value) === octet;
  });
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
