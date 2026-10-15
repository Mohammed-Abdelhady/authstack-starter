import { ConfigService } from '@nestjs/config';
import type { RoleAudience } from '../../host/types/host-role.type';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../session/constants/client-ids';
import type { BrowserSignInConfiguration } from '../types/host-policy.type';
import type { NativeApplicationConfiguration } from '../types/native-application.type';

export function configuredApplicationAudience(
  config: ConfigService,
  clientId: string,
): RoleAudience | undefined {
  if (clientId === WEB_CLIENT_ID || clientId === ADMIN_CLIENT_ID) {
    return config.get<BrowserSignInConfiguration>(`auth.${clientId}.signIn`)
      ?.audience;
  }
  if (!config.get<boolean>('auth.nativeEnabled', false)) return undefined;
  return config
    .get<NativeApplicationConfiguration[]>('auth.nativeApplications', [])
    .find((application) => application.clientId === clientId)?.audience;
}

export function configuredAccountAudiences(
  config: ConfigService,
): RoleAudience[] {
  const audiences = new Set<RoleAudience>();
  for (const clientId of [WEB_CLIENT_ID, ADMIN_CLIENT_ID]) {
    const audience = configuredApplicationAudience(config, clientId);
    if (audience) audiences.add(audience);
  }
  if (config.get<boolean>('auth.nativeEnabled', false)) {
    for (const application of config.get<NativeApplicationConfiguration[]>(
      'auth.nativeApplications',
      [],
    )) {
      if (application.audience) audiences.add(application.audience);
    }
  }
  return [...audiences];
}
