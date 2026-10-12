import { ConfigService } from '@nestjs/config';
import { CREDENTIAL_PURPOSE } from '../../../src/session/constants/credential-purpose';
import { bootE2eApp, type E2eApp } from '../e2e-app';
import { TEST_NOW } from '../frozen-clock';
import { createNativeApplication } from '../native/native-authorize.fixtures';
import { required } from './sdk-transport';

export type { E2eApp };

/** Boots the app the SDK contract drives through the typed client. */
export async function bootContractApp(): Promise<E2eApp> {
  return bootE2eApp();
}

/** Resets the clock, the database and the native client before each case. */
export async function resetContractApp(e2e: E2eApp): Promise<void> {
  e2e.clock.set(TEST_NOW);
  await e2e.reset();
  e2e.app.get(ConfigService).set('auth.nativeEnabled', true);
  await createNativeApplication(e2e);
}

/** The session a native bearer itself runs on. */
export async function contractNativeSessionId(e2e: E2eApp): Promise<string> {
  return required(
    await e2e.state.sessions.sessionIdWithPurpose(
      CREDENTIAL_PURPOSE.NATIVE_ACCESS,
    ),
    'native session',
  );
}
