import {
  PersistenceTimeoutError,
  PersistenceUnavailableError,
} from './persistence-errors';

/** Initial attempt plus two bounded retries for a transient boot outage. */
export const STORAGE_STARTUP_ATTEMPTS = 3;
export const STORAGE_STARTUP_RETRY_DELAY_MS = 500;
export const STORAGE_STARTUP_CONNECTION_TIMEOUT_MS = 3000;

export type StartupPause = () => Promise<void>;

const pause: StartupPause = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, STORAGE_STARTUP_RETRY_DELAY_MS);
  });

export async function retryStorageStartup<Result>(
  work: () => Promise<Result>,
  wait: StartupPause = pause,
): Promise<Result> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const transient =
        error instanceof PersistenceUnavailableError ||
        error instanceof PersistenceTimeoutError;
      if (!transient || attempt >= STORAGE_STARTUP_ATTEMPTS) throw error;
      await wait();
    }
  }
}
