import type { NativeSignInConfiguration } from '../../../config/types/native-application.type';

/** Stored comparison snapshot; reconciliation owns policy version changes. */
export type ApplicationSignInMethods = Readonly<
  NativeSignInConfiguration & {
    firstParty?: boolean;
    oauth?: boolean; // feature:oauth-core
  }
>;
