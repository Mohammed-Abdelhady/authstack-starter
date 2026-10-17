import { ConfigService } from '@nestjs/config';
import { API_GLOBAL_PREFIX } from '../../../common/constants/http-routes';
import type { BrowserApplications } from '../../applications/browser-applications';
import { SUPPORTED_LOCALES } from '../../../common/constants/locales';
import type { NativeApplicationConfiguration } from '../../../config/types/native-application.type';
import { nativeLinkHostname } from '../../../config/utils/native-link-hostname';
import { LINKED_MAIL_NAMES } from '../../../mail/constants/mail-names';
import {
  MAIL_AUDIENCE,
  MAIL_LINK_SETTING,
  mailLinkFor,
} from '../../../mail/links/mail-links';
import type { MailLinkSettings } from '../../../mail/links/mail-links';
import type { LinkHostManifest } from './types/link-host';
import { canonicalLinkHostPath } from './link-host-path';
import {
  LINK_HOST_ACME_CHALLENGE_PREFIX,
  LINK_HOST_ASSOCIATION_PATHS,
  LINK_HOST_RESERVED_PATH_PREFIXES,
} from './constants/link-host';
// feature:magic-link:start
import { browserMagicLinkUrl } from '../../../auth/magic-link/utils/magic-link-browser-context';
import { ADMIN_CLIENT_ID } from '../../constants/client-ids';
// feature:magic-link:end

export function effectiveNativeApplications(
  config: ConfigService,
): readonly NativeApplicationConfiguration[] {
  return config.get<boolean>('auth.nativeEnabled', false)
    ? config.get<NativeApplicationConfiguration[]>(
        'auth.nativeApplications',
        [],
      )
    : [];
}

function addPath(paths: Set<string>, url: string, source: string): void {
  const path = canonicalLinkHostPath(new URL(url).pathname || '/');
  if (path === undefined) {
    throw new Error(
      `${source}: choose a link path outside ${LINK_HOST_RESERVED_PATH_PREFIXES.join(', ')} without whitespace, encoded separators, backslashes or controls`,
    );
  }
  paths.add(path);
}

/** Real builders expand custom templates and every shipped language. */
export function effectiveLinkHostPaths(
  config: ConfigService,
  _applications: BrowserApplications,
): readonly string[] {
  const paths = new Set<string>();
  for (const application of effectiveNativeApplications(config)) {
    for (const [index, redirect] of application.redirectUris.entries()) {
      addPath(
        paths,
        redirect,
        `AUTH_NATIVE_APPLICATIONS ${application.clientId}.redirectUris[${index}]`,
      );
    }
  }
  for (const locale of SUPPORTED_LOCALES) {
    const recipient = { email: '', locale };
    for (const audience of Object.values(MAIL_AUDIENCE)) {
      for (const mail of LINKED_MAIL_NAMES) {
        const setting = config.get<MailLinkSettings>('mail.links')?.[audience]
          ? MAIL_LINK_SETTING[audience]
          : 'CLIENT_URL';
        addPath(
          paths,
          mailLinkFor(config, mail, audience, recipient),
          `${setting}.${mail} (${locale})`,
        );
      }
    }
    // feature:magic-link:start
    if (_applications.isConfigured(ADMIN_CLIENT_ID)) {
      const link = browserMagicLinkUrl(
        config,
        _applications.configuration(ADMIN_CLIENT_ID),
        recipient,
        '',
      );
      addPath(paths, link, 'ADMIN_URL magicLink');
    }
    // feature:magic-link:end
  }
  return [...paths].sort();
}

export function linkHostManifest(
  config: ConfigService,
  applications: BrowserApplications,
): LinkHostManifest {
  const configured = config.get<string>('auth.nativeLinkHost');
  return {
    host: configured ? nativeLinkHostname(configured) : undefined,
    paths: configured ? effectiveLinkHostPaths(config, applications) : [],
    apiPrefix: API_GLOBAL_PREFIX,
    reservedPathPrefixes: LINK_HOST_RESERVED_PATH_PREFIXES,
    associationPaths: Object.values(LINK_HOST_ASSOCIATION_PATHS),
    acmeChallengePrefix: LINK_HOST_ACME_CHALLENGE_PREFIX,
  };
}
