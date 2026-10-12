import {
  createDeviceKey,
  type DeviceKeyNativeApi,
  type DeviceKeyReadiness,
  type KeyProtection,
} from '@app/device-key';
import {
  createFetchTransport,
  createNativePorts,
  REQUEST_DEADLINE_MS,
  type HttpApi,
  type NativeModules,
} from '@app/native-adapters';
import {
  createAuthEngine,
  type AbortSignalPort,
  type AuthConfiguration,
  type AuthEngine,
  type DeviceKeyPort,
} from '@app/native-auth';
import { createApiClient, type ApiClient } from '@app/sdk';
import { SHELL_FAILURE } from './constants';
import { createDebugTransport, type DebugTransport } from './logic/debug-transport';

/** Everything native the shell touches, so a test can stand in for all of it. */
export interface ShellModules<TAlgorithm, TSignal, THandle> extends NativeModules<
  TAlgorithm,
  THandle
> {
  http: HttpApi<TSignal>;
}

export interface ShellSettings {
  configuration: AuthConfiguration;
  ephemeralBrowserSession: boolean;
}

export interface ShellAuth {
  engine: AuthEngine;
  client: ApiClient<AbortSignalPort>;
  debug: DebugTransport;
  /** Wall time from the same clock the engine reads. */
  now(): number;
}

export interface StartModules<TAlgorithm, TSignal, THandle> extends ShellModules<
  TAlgorithm,
  TSignal,
  THandle
> {
  deviceKey: DeviceKeyNativeApi;
}

export interface StartSettings extends ShellSettings {
  keyProtection: KeyProtection;
}

export interface StartedShellAuth extends ShellAuth {
  /** What the key answered at start, before the engine was built. */
  deviceKey: DeviceKeyReadiness;
}

/**
 * Prepares the device key once, then builds the engine. A device with no secure
 * hardware gets an engine without a key, so its session is an ordinary unbound one.
 */
export async function startShellAuth<TAlgorithm, TSignal, THandle>(
  modules: StartModules<TAlgorithm, TSignal, THandle>,
  { keyProtection, ...settings }: StartSettings,
): Promise<StartedShellAuth> {
  const { clientId, environment } = settings.configuration;
  const key = createDeviceKey(modules.deviceKey, {
    clientId,
    environment,
    protection: keyProtection,
  });
  const readiness = await key.prepare();
  const bound = readiness.kind !== 'noSecureHardware';
  return { ...createShellAuth(modules, settings, bound ? key : undefined), deviceKey: readiness };
}

/** One engine for the app's one credential record. */
export function createShellAuth<TAlgorithm, TSignal, THandle>(
  modules: ShellModules<TAlgorithm, TSignal, THandle>,
  { configuration, ephemeralBrowserSession }: ShellSettings,
  deviceKey?: DeviceKeyPort,
): ShellAuth {
  const ports = createNativePorts(modules, {
    clientId: configuration.clientId,
    environment: configuration.environment,
    ephemeralBrowserSession,
  });
  const transports: DebugTransport[] = [];
  const engine = createAuthEngine(configuration, {
    ...ports,
    makeTransport(baseAddress) {
      const debug = createDebugTransport(
        createFetchTransport(modules.http, ports.timer, baseAddress, REQUEST_DEADLINE_MS),
      );
      transports.push(debug);
      return debug.transport;
    },
    ...(deviceKey === undefined ? {} : { deviceKey }),
  });
  const [debug] = transports;
  if (debug === undefined) throw new Error(SHELL_FAILURE.NO_TRANSPORT);
  return {
    engine,
    client: createApiClient(engine.transport),
    debug,
    now: () => ports.clock.wallTime(),
  };
}
