import { ConfigService } from '@nestjs/config';
import type { BrowserApplications } from '../../session/applications/browser-applications';
import { HttpStatus } from '@nestjs/common';
import type { RequestHandler } from 'express';
import { negotiateLocale } from '../constants/locales';
import { requestHostname } from '../../config/utils/native-link-hostname';
import {
  LINK_HOST_ASSOCIATION_PATHS,
  LINK_HOST_CONTENT_SECURITY_POLICY,
} from '../../session/native/association/constants/link-host';
import {
  appleAssociation,
  androidAssociation,
} from '../../session/native/association/link-host-associations';
import {
  effectiveNativeApplications,
  linkHostManifest,
} from '../../session/native/association/link-host-paths';
import { linkHostPages } from '../../session/native/association/link-host-page';
import { canonicalLinkHostPath } from '../../session/native/association/link-host-path';

export function nativeLinkHostMiddleware(
  config: ConfigService,
  browserApplications: BrowserApplications,
): RequestHandler {
  const manifest = linkHostManifest(config, browserApplications);
  if (!manifest.host) return (_request, _response, next) => next();
  const paths = new Set(manifest.paths);
  const applications = effectiveNativeApplications(config);
  const apple = appleAssociation(applications, manifest.host);
  const android = androidAssociation(applications);
  const pages = linkHostPages();
  return (request, response, next) => {
    if (requestHostname(request.headers.host) !== manifest.host) {
      next();
      return;
    }
    response.set({
      'Content-Security-Policy': LINK_HOST_CONTENT_SECURITY_POLICY,
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    const path = canonicalLinkHostPath(request.url.split('?')[0]);
    if (!['GET', 'HEAD'].includes(request.method) || path === undefined) {
      response.status(HttpStatus.NOT_FOUND).end();
    } else if (path === LINK_HOST_ASSOCIATION_PATHS.APPLE) {
      response.status(HttpStatus.OK).json(apple);
    } else if (path === LINK_HOST_ASSOCIATION_PATHS.ANDROID) {
      response.status(HttpStatus.OK).json(android);
    } else if (paths.has(path)) {
      const locale = negotiateLocale(request.headers['accept-language']);
      response.setHeader('Content-Language', locale);
      response.status(HttpStatus.OK).type('html').send(pages.get(locale));
    } else {
      response.status(HttpStatus.NOT_FOUND).end();
    }
  };
}
