import { KEY_PROTECTION, type KeyProtection } from '@app/device-key';
import type { AuthConfiguration } from '@app/native-auth';
import appConfig from '../app.json';
import {
  APP_CALLBACK_URI,
  APP_CLIENT_ID,
  AUTH_SCOPE,
  DEVELOPMENT_ENVIRONMENT,
  DEVELOPMENT_API_ORIGIN,
  PRODUCTION_ENVIRONMENT,
  PRODUCTION_API_ORIGIN,
} from './constants';

declare const __DEV__: boolean;

export const API_ORIGIN = __DEV__ ? DEVELOPMENT_API_ORIGIN : PRODUCTION_API_ORIGIN;

export const AUTH_CONFIGURATION: AuthConfiguration = {
  serverBaseAddress: API_ORIGIN,
  environment: __DEV__ ? DEVELOPMENT_ENVIRONMENT : PRODUCTION_ENVIRONMENT,
  clientId: APP_CLIENT_ID,
  redirectUri: APP_CALLBACK_URI,
  scopes: [AUTH_SCOPE],
};

export const EPHEMERAL_BROWSER_SESSION = true;

/**
 * The one place that decides whether this build may sign with a software key.
 * A software key exists so a simulator can run the bound flow. A release build never makes one.
 */
export const DEVICE_KEY_PROTECTION: KeyProtection = __DEV__
  ? KEY_PROTECTION.SOFTWARE_ALLOWED
  : KEY_PROTECTION.HARDWARE_ONLY;

/** The product name the sign-in screen shows, as the home screen shows it. */
export const APP_NAME = appConfig.displayName;
