export interface NativeProviderSignInConfiguration {
  id: string;
  mode:
    'system' | 'googleIdentityToken' | 'appleIdentityTokenAndCode' | 'facebook';
  webClientId?: string;
  iosClientId?: string;
  appId?: string;
}

export interface NativeSignInConfiguration {
  password?: boolean;
  emailLink?: boolean;
  passkeys?: boolean;
  registration?: boolean;
  recovery?: boolean;
  providers?: NativeProviderSignInConfiguration[];
  /** Exact trusted origins for native WebAuthn ceremonies. */
  origins?: string[];
  rpId?: string;
}

export interface NativeApplicationConfiguration {
  clientId: string;
  displayName: string;
  redirectUris: string[];
  allowedScopes: string[];
  signIn?: NativeSignInConfiguration;
}
