export interface BrowserEmailCodeRequest {
  email: string;
  locale?: string;
}

/** The sign-in summary, before a full profile is fetched. */
export interface BrowserSignInUser {
  id: string;
  email: string;
  name: string;
  role: string;
  authProvider: string;
  isVerified: boolean;
  permissions: string[];
}

export type BrowserEmailCodeResult =
  { requiresTwoFactor: true; user: null } | { requiresTwoFactor: false; user: BrowserSignInUser };
