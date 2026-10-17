import type { NativeApplicationConfiguration } from '../../../config/types/native-application.type';
import {
  nativeLinkHostname,
  requestHostname,
} from '../../../config/utils/native-link-hostname';
import { canonicalLinkHostPath } from './link-host-path';
import { ANDROID_LINK_RELATIONS } from './constants/link-host';

export function appleAssociation(
  applications: readonly NativeApplicationConfiguration[],
  host: string,
) {
  const hostname = nativeLinkHostname(host);
  const appIds = new Set<string>();
  const pathsByApp = new Map<string, Set<string>>();
  for (const application of applications) {
    if (!application.appleAppId) continue;
    appIds.add(application.appleAppId);
    const paths = pathsByApp.get(application.appleAppId) ?? new Set<string>();
    for (const redirect of application.redirectUris) {
      const url = new URL(redirect);
      if (url.protocol !== 'https:' || requestHostname(url.host) !== hostname) {
        continue;
      }
      const path = canonicalLinkHostPath(url.pathname || '/');
      if (path !== undefined) paths.add(path);
    }
    if (paths.size) pathsByApp.set(application.appleAppId, paths);
  }
  return {
    applinks: {
      apps: [],
      details: [...pathsByApp].map(([appID, paths]) => ({
        appID,
        paths: [...paths].sort(),
      })),
    },
    webcredentials: { apps: [...appIds] },
  };
}

export function androidAssociation(
  applications: readonly NativeApplicationConfiguration[],
) {
  return applications.flatMap((application) => {
    if (
      !application.androidPackage ||
      !application.androidCertificates?.length
    ) {
      return [];
    }
    return [
      {
        relation: [...ANDROID_LINK_RELATIONS],
        target: {
          namespace: 'android_app',
          package_name: application.androidPackage,
          sha256_cert_fingerprints: [...application.androidCertificates],
        },
      },
    ];
  });
}
