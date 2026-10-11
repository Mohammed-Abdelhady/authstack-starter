import {
  FAKE_SHA256,
  FakeCrypto,
  FakeLinking,
  FakeMarkerFile,
  FakeSecureStore,
  FakeServer,
  FakeTime,
  FakeUuid,
  FakeWebBrowser,
} from '@app/native-adapters/testing';
import { resolveConfig } from '../../src/logic/resolve-config';
import { createShellAuth, type StartedShellAuth } from '../../src/shell';

/** A real engine over the adapter fakes, with the key already answered. Dispose it when done. */
export function startShell(): { auth: StartedShellAuth } {
  const clock = new FakeTime();
  const auth = createShellAuth(
    {
      secureStore: new FakeSecureStore(),
      keychainOptions: { keychainAccessible: 4 },
      webBrowser: new FakeWebBrowser(),
      crypto: new FakeCrypto(),
      sha256Algorithm: FAKE_SHA256,
      linking: new FakeLinking(null),
      installMarker: new FakeMarkerFile(),
      recordMarker: new FakeMarkerFile(),
      uuid: new FakeUuid(),
      clock,
      timers: clock,
      http: new FakeServer(),
    },
    {
      configuration: resolveConfig({
        apiOrigin: undefined,
        development: true,
        scheme: 'com.example.mobile',
      }),
      ephemeralBrowserSession: true,
    },
  );
  return { auth: { ...auth, deviceKey: { kind: 'noSecureHardware' } } };
}
