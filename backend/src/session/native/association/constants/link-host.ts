import {
  API_GLOBAL_PREFIX,
  HEALTH_ROUTE,
} from '../../../../common/constants/http-routes';

export const LINK_HOST_ACME_CHALLENGE_PREFIX = '/.well-known/acme-challenge/';

export const LINK_HOST_ASSOCIATION_PATHS = {
  APPLE: '/.well-known/apple-app-site-association',
  ANDROID: '/.well-known/assetlinks.json',
} as const;

export const ANDROID_LINK_RELATIONS = [
  'delegate_permission/common.handle_all_urls',
  'delegate_permission/common.get_login_creds',
] as const;

export const LINK_HOST_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const LINK_HOST_RESERVED_PATH_PREFIXES = [
  `/${API_GLOBAL_PREFIX}`,
  `/${HEALTH_ROUTE}`,
  '/docs',
  '/api-docs',
  '/swagger',
  '/assets',
  '/_next',
  '/static',
  LINK_HOST_ACME_CHALLENGE_PREFIX.slice(0, -1),
] as const;
