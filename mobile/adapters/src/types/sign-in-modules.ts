import type { NativeProviderMethod } from '@app/sdk';

export type NativeSignInPlatform = 'ios' | 'android' | 'web' | 'other';

export interface NativeSignInSettings {
  googleIosUrlScheme?: string;
  appleSignInEnabled: boolean;
  iosBundleIdentifier?: string;
  facebookAppId?: string;
  facebookClientToken?: string;
  facebookDisplayName?: string;
  passkeyRpId?: string;
}

export interface GoogleSignInApi {
  isAvailable(): boolean | Promise<boolean>;
  configure(options: {
    webClientId: string;
    iosClientId?: string;
    nonce: string;
  }): void | Promise<void>;
  presentExplicitSignIn(): Promise<unknown>;
}

export interface AppleAuthenticationApi {
  isAvailableAsync(): Promise<boolean>;
  signInAsync(options: {
    requestedScopes: number[];
    state: string;
    nonce: string;
  }): Promise<unknown>;
}

export interface FacebookSettingsApi {
  setAppID(appId: string): void;
  setClientToken(clientToken: string): void;
  setAppName(displayName: string): void;
  initializeSDK(): void;
}

export interface FacebookLoginApi {
  logInWithPermissions(
    permissions: string[],
    loginTracking?: 'enabled' | 'limited',
    nonce?: string,
  ): Promise<unknown>;
}

export interface FacebookAccessTokenApi {
  getCurrentAccessToken(): Promise<unknown>;
}

export interface FacebookAuthenticationTokenApi {
  getAuthenticationTokenIOS(): Promise<unknown>;
}

export interface FacebookSignInApi {
  settings: FacebookSettingsApi;
  loginManager: FacebookLoginApi;
  accessToken: FacebookAccessTokenApi;
  authenticationToken: FacebookAuthenticationTokenApi;
}

export type NativePasskeyTransport = 'ble' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb';

export interface NativePasskeyRequestOptions {
  challenge: string;
  timeout?: number;
  rpId: string;
  allowCredentials?: {
    type: 'public-key';
    id: string;
    transports?: NativePasskeyTransport[];
  }[];
  userVerification?: 'required' | 'preferred' | 'discouraged';
}

export interface NativePasskeysApi {
  isSupported(): boolean | Promise<boolean>;
  get(options: NativePasskeyRequestOptions): Promise<unknown>;
}

export interface NativeSignInModules {
  platform: NativeSignInPlatform;
  google: GoogleSignInApi;
  apple: AppleAuthenticationApi;
  appleScopes: { fullName: number; email: number };
  facebook: FacebookSignInApi;
  passkeys: NativePasskeysApi;
}

export interface NativeProviderAvailability {
  available(method: NativeProviderMethod): Promise<boolean>;
}
