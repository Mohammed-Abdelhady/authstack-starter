export interface NativeBuildSettings {
  googleIosUrlScheme?: string;
  appleSignIn?: boolean;
  facebookAppId?: string;
  facebookClientToken?: string;
  facebookDisplayName?: string;
  passkeyRpId?: string;
  appLinkHost?: string;
  appLinkPath?: string;
}

export type NativeBuildPlugin = string | [string, Record<string, string | boolean>];

export interface NativeBuildIntentFilter {
  action: string;
  autoVerify?: boolean;
  data: { scheme: string; host: string; pathPrefix: string }[];
  category: string[];
}

export interface NativeBuildConfiguration {
  name?: string;
  extra?: Record<string, unknown> & { nativeSignIn?: NativeBuildSettings };
  plugins?: NativeBuildPlugin[];
  ios?: {
    bundleIdentifier?: string;
    usesAppleSignIn?: boolean;
    associatedDomains?: string[];
  };
  android?: {
    package?: string;
    intentFilters?: NativeBuildIntentFilter[];
  };
}
