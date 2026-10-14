import type { E2eAccountFixture, E2eApplication } from './e2e-storage';

/** An account a case stores without going through sign-up. */
export interface E2eNewAccount {
  email: string;
  name: string;
  role?: string;
  isVerified?: boolean;
  isDeleted?: boolean;
  pendingEmail?: string;
  addressGeneration?: number;
  /** Stored as given. Left out, the store's default applies. */
  locale?: string;
  /** Already hashed. */
  password?: string;
}

/** A stored account as a case reads it. The id is a string on either database. */
export interface E2eStoredAccount {
  _id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  isVerified: boolean;
  isDeleted: boolean;
  pendingEmail?: string;
  /** Absent on an account that was never deactivated or was reactivated. */
  deletedAt?: Date;
  addressGeneration: number;
  /** The language as stored, absent where the record holds none. */
  locale?: string;
  /** The stored hash, when the read asks for it and the account has one. */
  password?: string;
}

/** Accounts as every area's cases arrange and read them. */
export interface E2eAccountsState {
  /** Stores seed accounts as given, an unverified one included. */
  seedAccounts(accounts: E2eAccountFixture[]): Promise<void>;
  /** Stores an account as given and answers its id. */
  createAccount(account: E2eNewAccount): Promise<{ _id: string }>;
  /** The id of the account at this address, if there is one. */
  accountIdFor(email: string): Promise<string | null>;
  /** The account at this address, with its password hash. */
  accountWithAddress(email: string): Promise<E2eStoredAccount | null>;
  /** The account as it is stored now, without its password hash. */
  accountWithId(id: string): Promise<E2eStoredAccount | null>;
}

export interface E2eStoredSession {
  isValid: boolean;
  proofKeyThumbprint?: string;
}

/** Sessions as every area's cases read them. */
export interface E2eSessionsState {
  /** The id of a session issued for this credential purpose, if there is one. */
  sessionIdWithPurpose(purpose: string): Promise<string | null>;
  countSessions(): Promise<number>;
  /** The session with this id. */
  session(id: string): Promise<E2eStoredSession | null>;
}

export interface E2eStoredApplication {
  clientId: string;
  displayName: string;
  platform: string;
  clientType: string;
  enabled: boolean;
  redirectUris: string[];
  allowedOrigins: string[];
}

/** An application registered with only what a browser client must name. */
export type E2eBrowserApplication = Pick<
  E2eApplication,
  | 'clientId'
  | 'displayName'
  | 'platform'
  | 'environment'
  | 'clientType'
  | 'allowedOrigins'
>;

export type E2eApplicationChange = Partial<
  Pick<E2eApplication, 'enabled' | 'redirectUris'>
>;

/** Applications as every area's cases register, change and read them. */
export interface E2eApplicationsState {
  createApplication(application: E2eApplication): Promise<void>;
  /** Registers an application and leaves the rest to the defaults. */
  registerBrowserApplication(application: E2eBrowserApplication): Promise<void>;
  /** The application with this client id, in one environment when named. */
  application(
    clientId: string,
    environment?: string,
  ): Promise<E2eStoredApplication | null>;
  applicationCount(clientId: string): Promise<number>;
  applicationCountIn(environment: string): Promise<number>;
  removeApplicationsIn(environment: string): Promise<void>;
  changeApplication(
    clientId: string,
    change: E2eApplicationChange,
  ): Promise<void>;
  /** Stores return addresses as given, ones registration would refuse included. */
  storeApplicationRedirects(
    clientId: string,
    redirectUris: string[],
  ): Promise<void>;
}
