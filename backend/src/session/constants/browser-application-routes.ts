import {
  API_GLOBAL_PREFIX,
  HEALTH_ROUTE,
} from '../../common/constants/http-routes';

const OPTIONAL_API_PREFIX = `(?:${API_GLOBAL_PREFIX}/)?`;
const AUTH_ROUTE = `^/${OPTIONAL_API_PREFIX}auth/`;

export const BROWSER_APPLICATION_ROUTES = {
  ENROLMENT_READ: new RegExp(
    `${AUTH_ROUTE}(?:csrf|browser-proof|identity)/?$`,
    'u',
  ),
  ENROLMENT_WRITE: new RegExp(
    `${AUTH_ROUTE}(?:logout|passkeys/register/(?:options|verify))/?$`,
    'u',
  ),
  MACHINE: new RegExp(
    `^/${OPTIONAL_API_PREFIX}(?:auth/native|oauth)(?:/|$)`,
    'u',
  ),
  MACHINE_METADATA: new RegExp(
    `^(?:/${HEALTH_ROUTE}/?|/${API_GLOBAL_PREFIX}/?|/|/${OPTIONAL_API_PREFIX}auth/oauth/providers/?)$`,
    'u',
  ),
  IDENTITY: new RegExp(`${AUTH_ROUTE}identity/?$`, 'u'),
  OAUTH_START: new RegExp(`${AUTH_ROUTE}oauth/[^/]+/start/?$`, 'u'),
  OAUTH_CALLBACK: new RegExp(`${AUTH_ROUTE}oauth/([^/]+)/callback/?$`, 'u'),
  MAGIC_LINK_VERIFY: new RegExp(`${AUTH_ROUTE}magic-link/verify/?$`, 'u'),
} as const;
