export const PRODUCTION = 'production';

export const SESSION_COOKIE_DEFAULT_NAME = 'sid';
export const SESSION_COOKIE_HOST_NAME = '__Host-sid';

/** Requests one client may average per second on the global limit in production. */
export const PRODUCTION_THROTTLE_MAX_PER_SECOND = 20;

export const PRODUCTION_PUBLIC_URL_MESSAGE =
  'must be an https address on a public host when NODE_ENV=production (not http, localhost or a loopback address)';
export const PRODUCTION_SWAGGER_MESSAGE =
  'SWAGGER_ENABLED=true is refused when NODE_ENV=production unless SWAGGER_ALLOW_IN_PRODUCTION=true';
export const PRODUCTION_DEVELOPMENT_ONLY_MESSAGE =
  'is a development setting for the seed script and must be unset when NODE_ENV=production';
export const PRODUCTION_THROTTLE_MESSAGE = `THROTTLE_LIMIT must not exceed ${PRODUCTION_THROTTLE_MAX_PER_SECOND} requests per second of THROTTLE_TTL when NODE_ENV=production`;
export const INSECURE_ENVIRONMENT_WARNING =
  'CLIENT_URL is https but NODE_ENV is not "production". Cookies are sent with Secure because of the address, but development defaults are still in force. Set NODE_ENV=production on a real deployment.';

const LOOPBACK_IPV4 = /^127(?:\.\d{1,3}){3}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '[::1]', '0.0.0.0', '[::]']);

function parseUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string' || !URL.canParse(value)) {
    return undefined;
  }
  return new URL(value);
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return (
    LOOPBACK_HOSTS.has(host) ||
    host.endsWith('.localhost') ||
    LOOPBACK_IPV4.test(host)
  );
}

/** True for an address browsers outside this machine reach over TLS. */
export function isPublicHttpsUrl(value: unknown): boolean {
  const url = parseUrl(value);
  return (
    url !== undefined &&
    url.protocol === 'https:' &&
    !isLoopbackHost(url.hostname)
  );
}

export function isHttpsUrl(value: unknown): boolean {
  return parseUrl(value)?.protocol === 'https:';
}

/**
 * Cookies carry Secure, and the session cookie its `__Host-` name, when the
 * server runs in production or the browser reaches the app over https. Either
 * one is enough, so a deployment that forgot NODE_ENV still gets them.
 */
export function usesSecureCookies(
  nodeEnv: unknown,
  clientUrl: unknown,
): boolean {
  return nodeEnv === PRODUCTION || isHttpsUrl(clientUrl);
}

export function defaultSessionCookieName(
  nodeEnv: unknown,
  clientUrl: unknown,
): string {
  return usesSecureCookies(nodeEnv, clientUrl)
    ? SESSION_COOKIE_HOST_NAME
    : SESSION_COOKIE_DEFAULT_NAME;
}

/** The limit a production server accepts for the given window, in seconds. */
export function isProductionThrottle(limit: unknown, ttl: unknown): boolean {
  if (typeof limit !== 'number' || typeof ttl !== 'number') {
    return true;
  }
  return limit <= ttl * PRODUCTION_THROTTLE_MAX_PER_SECOND;
}

/** What the server logs once at start, if the environment looks half set. */
export function startupEnvironmentWarning(
  nodeEnv: unknown,
  clientUrl: unknown,
): string | undefined {
  return nodeEnv !== PRODUCTION && isHttpsUrl(clientUrl)
    ? INSECURE_ENVIRONMENT_WARNING
    : undefined;
}
