import { KEY_PROTECTION, type KeyProtection } from '@app/device-key';
import type { AuthConfiguration } from '@app/native-auth';

/** What follows the scheme in the address sign-in returns to. */
export const CALLBACK_LOCATION = 'oauth/callback';
export const SCOPES = ['api'] as const;
export const DEVELOPMENT_API_ORIGIN = 'http://localhost:5001';
export const ENVIRONMENT = { DEVELOPMENT: 'development', PRODUCTION: 'production' } as const;
export const API_ORIGIN_VARIABLE = 'EXPO_PUBLIC_API_ORIGIN';

export interface ConfigInput {
  apiOrigin: string | undefined;
  development: boolean;
  /** The `scheme` in app.json. The server knows the app by it, and sign-in returns through it. */
  scheme: string;
}

/** Only a development build falls back to the local server. */
export function resolveConfig({ apiOrigin, development, scheme }: ConfigInput): AuthConfiguration {
  const configured = apiOrigin?.trim();
  const origin = configured || (development ? DEVELOPMENT_API_ORIGIN : undefined);
  if (origin === undefined) throw new Error(`${API_ORIGIN_VARIABLE} is not set.`);
  return {
    serverBaseAddress: origin,
    environment: development ? ENVIRONMENT.DEVELOPMENT : ENVIRONMENT.PRODUCTION,
    clientId: scheme,
    redirectUri: `${scheme}://${CALLBACK_LOCATION}`,
    scopes: SCOPES,
  };
}

/** A software key exists so a simulator can run the bound flow. A release build never makes one. */
export function resolveKeyProtection(development: boolean): KeyProtection {
  return development ? KEY_PROTECTION.SOFTWARE_ALLOWED : KEY_PROTECTION.HARDWARE_ONLY;
}

/** The sign-in check screen is a development tool. A release build never opens it. */
export function resolveDebugAccess(development: boolean): boolean {
  return development;
}
