import type { NativeSignInConfiguration } from '../../../config/types/native-application.type';

/** Stored comparison snapshot; reconciliation owns policy version changes. */
export type ApplicationSignInMethods = Readonly<
  Omit<NativeSignInConfiguration, 'rpId' | 'origins'>
>;
