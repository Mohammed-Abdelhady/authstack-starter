import { AUTH_CONFIGURATION, DEVICE_KEY_PROTECTION, EPHEMERAL_BROWSER_SESSION } from './config';
import { createNativeShellAuth } from './engine';
import type { StartedShellAuth } from './shell';

export type Start = { auth: StartedShellAuth } | { failure: unknown };

/**
 * Started once per process: the key is prepared before the engine exists. It
 * lives apart from the screens so that editing one in development does not
 * build a second engine, which would spend the same refresh token twice.
 */
export const START: Promise<Start> = Promise.resolve()
  .then(() =>
    createNativeShellAuth(AUTH_CONFIGURATION, EPHEMERAL_BROWSER_SESSION, DEVICE_KEY_PROTECTION),
  )
  .then(
    (auth) => ({ auth }),
    (failure: unknown) => ({ failure }),
  );
