/** What names the mobile app on a device, in a store and to the server. */
export interface MobileIdentity {
  /** The name under the icon. */
  name: string;
  /** Expo's name for the project in addresses and build output. */
  slug: string;
  /** The iOS bundle identifier and the Android package, one value for both. */
  appId: string;
  /** The scheme sign-in returns through. The server knows the app by it. */
  scheme: string;
}

export type MobileIdentityField = keyof MobileIdentity;

/** The fields a flag, a config file or a prompt gave. The rest take defaults. */
export type MobileIdentityRequest = Partial<MobileIdentity>;
