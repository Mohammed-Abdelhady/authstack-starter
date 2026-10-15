import { AVAILABLE_AUTH_FEATURES } from '../../auth/constants/available-auth-features';
import { AuthFeature } from '../../auth/enums/auth-feature.enum';
import { ROLE_AUDIENCE } from '../../host/types/host-role.type';
import type { EnvironmentVariables } from '../env.schema';
import { SIGN_UP_POLICY } from '../constants/host-contracts';
import type { ApplicationPolicyConfiguration } from '../types/host-policy.type';
import { parseBrowserSignIn } from './host-policy-config.util';
import { parseNativeApplications } from './native-application-config.util';
import { nativePasskeysAvailable } from './native-passkeys-available';
import {
  isPublicHttpsUrl,
  PRODUCTION,
  PRODUCTION_PUBLIC_URL_MESSAGE,
} from './production-environment.util';

export function validateHostApplications(
  config: EnvironmentVariables & { readonly PASSKEYS_ENABLED?: boolean },
): void {
  if (config.AUTH_ADMIN_SIGN_IN && !config.ADMIN_URL) {
    throw new Error(
      'AUTH_ADMIN_SIGN_IN requires ADMIN_URL; set ADMIN_URL to the admin browser origin or remove AUTH_ADMIN_SIGN_IN',
    );
  }
  if (config.ADMIN_URL) {
    if (
      new URL(config.ADMIN_URL).origin === new URL(config.CLIENT_URL).origin
    ) {
      throw new Error(
        'ADMIN_URL must have a different origin from CLIENT_URL; choose a separate admin origin',
      );
    }
    if (config.NODE_ENV === PRODUCTION && !isPublicHttpsUrl(config.ADMIN_URL)) {
      throw new Error(
        `ADMIN_URL ${PRODUCTION_PUBLIC_URL_MESSAGE}; set ADMIN_URL to a public HTTPS origin`,
      );
    }
  }

  const passkeysAvailable =
    AVAILABLE_AUTH_FEATURES.has(AuthFeature.PASSKEYS) &&
    config.PASSKEYS_ENABLED !== false;
  for (const setting of ['AUTH_WEB_SIGN_IN', 'AUTH_ADMIN_SIGN_IN'] as const) {
    const policy = parseBrowserSignIn(config[setting], setting);
    validateApplicationPolicy(
      policy,
      setting,
      passkeysAvailable,
      policy?.passkeys !== false,
      'set passkeys to true',
    );
  }
  if (!config.AUTH_NATIVE_ENABLED) return;

  const applications = parseNativeApplications(
    config.AUTH_NATIVE_APPLICATIONS,
    {
      nodeEnv: config.NODE_ENV,
      allowCustomScheme: config.AUTH_NATIVE_ALLOW_CUSTOM_SCHEME,
    },
  );
  for (const application of applications) {
    validateApplicationPolicy(
      application,
      `AUTH_NATIVE_APPLICATIONS entry ${JSON.stringify(application.clientId)}`,
      passkeysAvailable,
      nativePasskeysAvailable(application.signIn),
      'set signIn.passkeys to true and supply signIn.rpId and exact signIn.origins',
    );
  }
}

function validateApplicationPolicy(
  policy: ApplicationPolicyConfiguration | undefined,
  setting: string,
  passkeysAvailable: boolean,
  applicationPasskeys: boolean,
  applicationFix: string,
): void {
  if (
    policy?.audience === ROLE_AUDIENCE.STAFF &&
    policy.signUp !== SIGN_UP_POLICY.CLOSED
  ) {
    throw new Error(
      `${setting}: staff audience requires signUp to be closed; set signUp to "closed" or choose another audience`,
    );
  }
  if (!policy?.requirePasskey) return;
  if (!passkeysAvailable) {
    throw new Error(
      `${setting}: requirePasskey requires the passkeys feature and PASSKEYS_ENABLED=true; include passkeys and enable it, or set requirePasskey to false`,
    );
  }
  if (!applicationPasskeys) {
    throw new Error(
      `${setting}: requirePasskey requires application passkeys; ${applicationFix}, or set requirePasskey to false`,
    );
  }
}
