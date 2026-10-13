import {
  NATIVE_AUTH_FIRST_FACTOR,
  NATIVE_AUTH_FLOW,
  NATIVE_AUTH_SECOND_FACTOR,
  NATIVE_AUTH_STAGE,
  NATIVE_PROVIDER_CREDENTIAL_KIND,
  NATIVE_PROVIDER_SDK_MODE,
} from '../constants/native-auth';

export type NativeFlow = (typeof NATIVE_AUTH_FLOW)[keyof typeof NATIVE_AUTH_FLOW];
export type NativeStage = (typeof NATIVE_AUTH_STAGE)[keyof typeof NATIVE_AUTH_STAGE];
export type NativeFirstFactor =
  (typeof NATIVE_AUTH_FIRST_FACTOR)[keyof typeof NATIVE_AUTH_FIRST_FACTOR];
export type NativeSecondFactor =
  (typeof NATIVE_AUTH_SECOND_FACTOR)[keyof typeof NATIVE_AUTH_SECOND_FACTOR];
export type NativeProviderCredentialKind =
  (typeof NATIVE_PROVIDER_CREDENTIAL_KIND)[keyof typeof NATIVE_PROVIDER_CREDENTIAL_KIND];
export type NativeProviderSdkMode =
  (typeof NATIVE_PROVIDER_SDK_MODE)[keyof typeof NATIVE_PROVIDER_SDK_MODE];
