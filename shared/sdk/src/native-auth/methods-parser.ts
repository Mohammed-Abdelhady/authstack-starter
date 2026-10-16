import { NATIVE_AUTH_LIMITS, NATIVE_PROVIDER_SDK_MODE } from '@app/core';
import { unwrapAuthMethodsBody } from '../auth-methods';
import { requireArray, requireObject } from '../shapes';
import type { AuthMethodProvider, AuthMethods } from '../types';
import type { JsonFields } from '../types/json';
import type {
  NativeAuthCapabilities,
  NativeMethods,
  NativeProviderMethod,
  NativeProviderSdkConfiguration,
} from '../types/native-auth';
import { booleanValue, boundedString, exactKeys, fail } from './validation';

function parseAuthProviders(value: unknown, status: number): AuthMethodProvider[] {
  if (value === undefined) return [];
  const providers = requireArray(value, 'methods.oauth', status);
  if (providers.length > NATIVE_AUTH_LIMITS.PROVIDER_COUNT) {
    fail(status, 'methods.oauth', 'has too many providers');
  }
  return providers.map((provider, index) => {
    const field = `methods.oauth[${index}]`;
    const record: JsonFields<AuthMethodProvider> = requireObject(provider, field, status);
    exactKeys(record, ['id', 'displayName'], field, status);
    return {
      id: boundedString(record.id, `${field}.id`, NATIVE_AUTH_LIMITS.PROVIDER_ID, status),
      displayName: boundedString(
        record.displayName,
        `${field}.displayName`,
        NATIVE_AUTH_LIMITS.PROVIDER_NAME,
        status,
      ),
    };
  });
}

function parseCapabilities(value: unknown, status: number): NativeAuthCapabilities {
  const fields: JsonFields<NativeAuthCapabilities> = requireObject(value, 'capabilities', status);
  exactKeys(
    fields,
    [
      'password',
      'emailLink',
      'passkeys',
      'registration',
      'recovery',
      'emailCode', // feature:email-code
    ],
    'capabilities',
    status,
  );
  return {
    password: booleanValue(fields.password, 'capabilities.password', status),
    emailLink: booleanValue(fields.emailLink, 'capabilities.emailLink', status),
    passkeys: booleanValue(fields.passkeys, 'capabilities.passkeys', status),
    registration: booleanValue(fields.registration, 'capabilities.registration', status),
    recovery: booleanValue(fields.recovery, 'capabilities.recovery', status),
    // feature:email-code:start
    ...(fields.emailCode === undefined
      ? {}
      : { emailCode: booleanValue(fields.emailCode, 'capabilities.emailCode', status) }),
    // feature:email-code:end
  };
}

function parseSdkConfiguration(
  value: unknown,
  field: string,
  status: number,
): NativeProviderSdkConfiguration {
  const sdk: JsonFields<NativeProviderSdkConfiguration> = requireObject(value, field, status);
  if (sdk.kind === 'google') {
    exactKeys(sdk, ['kind', 'webClientId', 'iosClientId'], field, status);
    return {
      kind: 'google',
      webClientId: boundedString(
        sdk.webClientId,
        `${field}.webClientId`,
        NATIVE_AUTH_LIMITS.CLIENT_ID,
        status,
      ),
      ...(sdk.iosClientId === undefined
        ? {}
        : {
            iosClientId: boundedString(
              sdk.iosClientId,
              `${field}.iosClientId`,
              NATIVE_AUTH_LIMITS.CLIENT_ID,
              status,
            ),
          }),
    };
  }
  if (sdk.kind === 'apple' || sdk.kind === 'facebook') {
    exactKeys(sdk, ['kind', 'appId'], field, status);
    return {
      kind: sdk.kind,
      appId: boundedString(sdk.appId, `${field}.appId`, NATIVE_AUTH_LIMITS.CLIENT_ID, status),
    };
  }
  return fail(status, `${field}.kind`, 'is not supported');
}

function parseSdkProvider(
  provider: JsonFields<NativeProviderMethod>,
  identity: AuthMethodProvider,
  field: string,
  status: number,
): NativeProviderMethod {
  const { id, displayName } = identity;
  const sdk = parseSdkConfiguration(provider.sdk, `${field}.sdk`, status);
  if (
    provider.mode === NATIVE_PROVIDER_SDK_MODE.GOOGLE_IDENTITY_TOKEN &&
    id === 'google' &&
    sdk.kind === 'google'
  ) {
    exactKeys(provider, ['id', 'displayName', 'mode', 'sdk'], field, status);
    return { id, displayName, mode: NATIVE_PROVIDER_SDK_MODE.GOOGLE_IDENTITY_TOKEN, sdk };
  }
  if (
    provider.mode === NATIVE_PROVIDER_SDK_MODE.APPLE_IDENTITY_TOKEN_AND_CODE &&
    id === 'apple' &&
    sdk.kind === 'apple'
  ) {
    exactKeys(provider, ['id', 'displayName', 'mode', 'sdk'], field, status);
    return { id, displayName, mode: NATIVE_PROVIDER_SDK_MODE.APPLE_IDENTITY_TOKEN_AND_CODE, sdk };
  }
  if (
    provider.mode === NATIVE_PROVIDER_SDK_MODE.FACEBOOK &&
    id === 'facebook' &&
    sdk.kind === 'facebook'
  ) {
    exactKeys(provider, ['id', 'displayName', 'mode', 'sdk'], field, status);
    return { id, displayName, mode: NATIVE_PROVIDER_SDK_MODE.FACEBOOK, sdk };
  }
  return fail(status, `${field}.mode`, 'does not match its public SDK configuration');
}

function parseProviderMethods(
  value: unknown,
  enabledProviders: readonly AuthMethodProvider[],
  status: number,
): NativeProviderMethod[] {
  const entries = requireArray(value, 'providers', status);
  if (entries.length !== enabledProviders.length)
    fail(status, 'providers', 'does not match methods.oauth');
  const expectedIds = new Set(enabledProviders.map(({ id }) => id));
  const actualIds = new Set<string>();
  return entries.map((entry, index) => {
    const field = `providers[${index}]`;
    const provider: JsonFields<NativeProviderMethod> = requireObject(entry, field, status);
    const id = boundedString(provider.id, `${field}.id`, NATIVE_AUTH_LIMITS.PROVIDER_ID, status);
    const displayName = boundedString(
      provider.displayName,
      `${field}.displayName`,
      NATIVE_AUTH_LIMITS.PROVIDER_NAME,
      status,
    );
    if (!expectedIds.has(id) || actualIds.has(id))
      fail(status, field, 'does not match one enabled provider');
    actualIds.add(id);

    if (provider.mode === NATIVE_PROVIDER_SDK_MODE.SYSTEM) {
      exactKeys(provider, ['id', 'displayName', 'mode'], field, status);
      return { id, displayName, mode: NATIVE_PROVIDER_SDK_MODE.SYSTEM };
    }

    return parseSdkProvider(provider, { id, displayName }, field, status);
  });
}

export function parseNativeMethods(data: unknown, status: number): NativeMethods {
  const record: JsonFields<NativeMethods> = requireObject(data, 'data', status);
  exactKeys(record, ['nativeEnabled', 'methods', 'capabilities', 'providers'], 'data', status);
  const nativeEnabled = booleanValue(record.nativeEnabled, 'nativeEnabled', status);
  const methodRecord: JsonFields<AuthMethods> = requireObject(record.methods, 'methods', status);
  exactKeys(
    methodRecord,
    ['password', 'magicLink', 'twoFactor', 'passkeys', 'oauth'],
    'methods',
    status,
  );
  const authMethods = unwrapAuthMethodsBody({
    success: true,
    data: { methods: methodRecord },
  });
  const oauth = parseAuthProviders(methodRecord.oauth, status);
  const methods = {
    password: authMethods.password,
    magicLink: authMethods.magicLink,
    twoFactor: authMethods.twoFactor,
    passkeys: authMethods.passkeys,
    oauth,
  };

  return {
    nativeEnabled,
    methods,
    capabilities: parseCapabilities(record.capabilities, status),
    providers: parseProviderMethods(record.providers, oauth, status),
  };
}
