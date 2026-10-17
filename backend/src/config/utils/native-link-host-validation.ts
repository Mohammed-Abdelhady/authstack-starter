import type { EnvironmentVariables } from '../env.schema';
import { parseNativeApplications } from './native-application-config.util';
import { nativeLinkHostname } from './native-link-hostname';

export function validateNativeLinkHost(config: EnvironmentVariables): void {
  const production = config.NODE_ENV === 'production';
  const applications =
    production && config.AUTH_NATIVE_ENABLED
      ? parseNativeApplications(config.AUTH_NATIVE_APPLICATIONS, {
          nodeEnv: config.NODE_ENV,
          allowCustomScheme: config.AUTH_NATIVE_ALLOW_CUSTOM_SCHEME,
        })
      : [];
  if (!config.AUTH_NATIVE_LINK_HOST) {
    const firstParty = applications.find(
      (application) => application.firstParty,
    );
    if (firstParty) {
      throw new Error(
        `AUTH_NATIVE_APPLICATIONS ${firstParty.clientId}: production firstParty redirects require AUTH_NATIVE_LINK_HOST; set a dedicated link hostname`,
      );
    }
    return;
  }
  const host = nativeLinkHostname(config.AUTH_NATIVE_LINK_HOST);
  if (!config.API_URL) {
    throw new Error(
      'AUTH_NATIVE_LINK_HOST requires API_URL so the link host and API host can be kept distinct',
    );
  }
  for (const [setting, value] of [
    ['API_URL', config.API_URL],
    ['CLIENT_URL', config.CLIENT_URL],
    ['ADMIN_URL', config.ADMIN_URL],
  ] as const) {
    if (
      value &&
      new URL(value).hostname.toLowerCase().replace(/\.$/u, '') === host
    ) {
      throw new Error(
        `AUTH_NATIVE_LINK_HOST must differ from the ${setting} host; choose a dedicated link hostname`,
      );
    }
  }
  for (const application of applications) {
    if (!application.firstParty) continue;
    for (const redirect of application.redirectUris) {
      const url = new URL(redirect);
      if (
        url.protocol !== 'https:' ||
        url.hostname.toLowerCase().replace(/\.$/u, '') !== host
      ) {
        throw new Error(
          `AUTH_NATIVE_APPLICATIONS ${application.clientId}: firstParty redirects must use HTTPS on AUTH_NATIVE_LINK_HOST`,
        );
      }
    }
  }
}
