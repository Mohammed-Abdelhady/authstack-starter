import type { INestApplication } from '@nestjs/common';
import type { TestingModuleBuilder } from '@nestjs/testing';
import {
  startMongoE2eStorage,
  watchMongoFixtureConnections,
} from './e2e-mongo-storage';
import type { E2eAuthState } from './e2e-state-auth';
import type { E2eNativeState } from './e2e-state-native';
import type { E2eRecordsState } from './e2e-state-records';
import type {
  E2eAccountsState,
  E2eApplicationsState,
  E2eSessionsState,
} from './e2e-state-shared';

/** A seed account as the fixture stores it, its password already hashed. */
export interface E2eAccountFixture {
  email: string;
  name: string;
  role: string;
  permissions: string[];
  isVerified: boolean;
  password: string;
}

/** An application as a case registers it. */
export interface E2eApplication {
  clientId: string;
  displayName: string;
  platform: string;
  environment: string;
  clientType: string;
  enabled: boolean;
  redirectUris: string[];
  allowedOrigins: string[];
  audiences: string[];
  allowedScopes: string[];
  policy: { absoluteLifetimeMs: number; idleLifetimeMs: number };
  sessionVersion: number;
}

/**
 * What a case arranges and reads in the database without going through a
 * route. Each database's fixture answers these, so a case names what it needs
 * and never a collection or a table. What more than one area's cases need is
 * under the thing it is about. The rest is under the area that needs it.
 */
export interface E2eState {
  readonly accounts: E2eAccountsState;
  readonly sessions: E2eSessionsState;
  readonly applications: E2eApplicationsState;
  /** Sign-up, sign-in and account cases. */
  readonly auth: E2eAuthState;
  /** Mobile sign-in cases. */
  readonly native: E2eNativeState;
  /** Admin and permission cases. */
  readonly records: E2eRecordsState;
}

/** What a booted application's database gives the fixture between cases. */
export interface AttachedE2eStorage {
  readonly state: E2eState;
  /** Removes every stored row. */
  empty(): Promise<void>;
  /** Stores the first applications and allows the client origin. */
  seedApplications(): Promise<void>;
  seedAccounts(accounts: E2eAccountFixture[]): Promise<void>;
}

/**
 * The database one booted fixture owns. The fixture is the only thing that
 * knows which database a run is on: the application under test is told by its
 * environment, the way an installation is.
 */
export interface E2eStorage {
  /** The settings that point the application at this database. */
  readonly environment: Record<string, string>;
  /** Called on the testing module before it is compiled. */
  prepare(builder: TestingModuleBuilder): Promise<void>;
  attach(app: INestApplication): Promise<AttachedE2eStorage>;
  stop(): Promise<void>;
}

/**
 * Watches the database connections a fixture opens, from before it boots, so
 * a case can tell what a failed boot left behind.
 */
export interface FixtureConnectionWatch {
  /** Whether a connection the case opened beside the fixture is still there. */
  probePreserved(): Promise<boolean>;
  /** Connections opened since the watch began that are open or opening. */
  retryingConnections(): Promise<number>;
  close(): Promise<void>;
}

/** What a run on one database gives every suite: its fixtures and their watch. */
export interface E2eStorageChoice {
  start(): Promise<E2eStorage>;
  watchConnections(): Promise<FixtureConnectionWatch>;
}

let chosen: E2eStorageChoice = {
  start: startMongoE2eStorage,
  watchConnections: watchMongoFixtureConnections,
};

/**
 * Names the storage every fixture of this run boots on. A run on another
 * database calls it from its Jest setup file, before any suite is loaded. A
 * run that names none is on MongoDB.
 */
export function useE2eStorage(choice: E2eStorageChoice): void {
  chosen = choice;
}

export function startE2eStorage(): Promise<E2eStorage> {
  return chosen.start();
}

export function watchFixtureConnections(): Promise<FixtureConnectionWatch> {
  return chosen.watchConnections();
}
