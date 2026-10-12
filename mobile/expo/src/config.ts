import appConfig from '../app.json';
import { resolveConfig, resolveDebugAccess, resolveKeyProtection } from './logic/resolve-config';

/**
 * Expo replaces the variable at bundle time, so it has to be read by its full name.
 * The client id and the return address come from the scheme in app.json, nowhere else.
 */
export const AUTH_CONFIGURATION = resolveConfig({
  apiOrigin: process.env.EXPO_PUBLIC_API_ORIGIN,
  development: __DEV__,
  scheme: appConfig.expo.scheme,
});

/**
 * A private browser session: sign-in never reuses a cookie from an earlier
 * case, and iOS does not ask for permission to share one.
 */
export const EPHEMERAL_BROWSER_SESSION = true;

/** The one place that decides whether this build may sign with a software key. */
export const DEVICE_KEY_PROTECTION = resolveKeyProtection(__DEV__);

/** The product name the sign-in screen shows, as the home screen shows it. */
export const APP_NAME = appConfig.expo.name;

/**
 * The one place that decides whether the sign-in check screen can open. In a
 * development build, press and hold the empty band just under the status bar to open it.
 */
export const DEBUG_VIEW_AVAILABLE = resolveDebugAccess(__DEV__);
export const DEBUG_HOLD_MS = 1500;
/** The band reaches this far under the status bar, inside the padding every screen keeps empty. */
export const DEBUG_BAND_HEIGHT = 20;
