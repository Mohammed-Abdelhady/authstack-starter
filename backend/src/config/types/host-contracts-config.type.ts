import type {
  BrowserSessionConfiguration,
  BrowserSignInConfiguration,
} from './host-policy.type';

export interface HostAuthConfiguration {
  web: {
    enabled: boolean;
    enabledExplicit?: boolean;
    signIn?: BrowserSignInConfiguration;
    session?: BrowserSessionConfiguration;
  };
  admin: {
    signIn?: BrowserSignInConfiguration;
    session?: BrowserSessionConfiguration;
  };
  nativeLinkHost?: string;
}

export interface HostContractsConfiguration {
  // feature:email-code:start
  emailCode: {
    enabled: boolean;
    expiresIn: number;
    review: {
      accountId?: string;
      clientId?: string;
      codeHash?: string;
      until?: string;
    };
  };
  // feature:email-code:end
  activity: { retentionDays: number };
  invitations: { expiresIn: number }; // feature:invitations
  admin: { strictMutations: boolean };
  account: { eraseGraceDays?: number };
  providerTokens: {
    encryptionKey?: string;
    previousEncryptionKey?: string;
  };
}
