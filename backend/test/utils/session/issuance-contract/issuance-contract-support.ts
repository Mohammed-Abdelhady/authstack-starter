import { RerunPause } from '../../../../src/common/persistence/unit-of-work';
import { NewBrowserSession } from '../../../../src/session/issuance/browser-issuance.store';
import { SessionIssuanceService } from '../../../../src/session/services/session-issuance.service';
import { RaceGate } from '../../race-gate';
import {
  IssuanceContractHarness,
  SeedApplication,
} from './issuance-contract-harness';

export type HarnessSource = () => IssuanceContractHarness;

export const WEB_CLIENT = 'web';
export const ADMIN_CLIENT = 'admin';
export const SIGN_IN_ADDRESS = '127.0.0.1';
/** The caps, written out so a changed constant cannot agree with itself. */
export const SESSION_CAP = 20;
export const ADMIN_SESSION_CAP = 5;

const TWO_HOURS_MS = 7_200_000;
const TEN_MINUTES_MS = 600_000;

export const WEB_APPLICATION: SeedApplication = {
  clientId: WEB_CLIENT,
  platform: 'web',
  enabled: true,
  sessionVersion: 0,
  absoluteLifetimeMs: TWO_HOURS_MS,
  idleLifetimeMs: TEN_MINUTES_MS,
};

export const ADMIN_APPLICATION: SeedApplication = {
  clientId: ADMIN_CLIENT,
  platform: 'admin',
  enabled: true,
  sessionVersion: 0,
  absoluteLifetimeMs: TWO_HOURS_MS,
  idleLifetimeMs: TEN_MINUTES_MS,
};

/** Reruns at once. For cases where nothing is expected to rerun. */
export const rerunAtOnce: RerunPause = () => Promise.resolve();

export interface HeldRerun {
  pause: RerunPause;
  /** Reached once a unit of work was refused and is waiting to run again. */
  refused: RaceGate;
  /** The failed-attempt count each pause was called with. */
  calls: number[];
}

/** A rerun pause the case holds, so "was refused" is something it can await. */
export function holdReruns(): HeldRerun {
  const refused = new RaceGate();
  const calls: number[] = [];
  return {
    refused,
    calls,
    pause: async (failedAttempts) => {
      calls.push(failedAttempts);
      await refused.hold();
    },
  };
}

export async function signInTimes(
  service: SessionIssuanceService,
  userId: string,
  times: number,
  clientId = WEB_CLIENT,
): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await service.createBrowserSession(
      userId,
      `seeded/${index}`,
      SIGN_IN_ADDRESS,
      clientId,
    );
  }
}

/** What is stored for one account, as counts a case can compare in one go. */
export async function storedCounts(
  harness: IssuanceContractHarness,
  userId: string,
): Promise<{
  sessions: number;
  grants: number;
  grantFences: number[];
  accountFence: number | undefined;
  events: number;
}> {
  const grants = await harness.grants(userId);
  return {
    sessions: (await harness.sessions(userId)).length,
    grants: grants.length,
    grantFences: grants.map(({ issuanceFence }) => issuanceFence),
    accountFence: (await harness.account(userId))?.issuanceFence,
    events: (await harness.events()).filter(
      ({ targetUserId }) => targetUserId === userId,
    ).length,
  };
}

/** A browser session as the service would hand it to the store, fixed values. */
export function contractSession(
  userId: string,
  tokenHash: string,
): NewBrowserSession {
  const at = new Date('2099-01-01T12:00:00.000Z');
  return {
    userId,
    tokenHash,
    csrfToken: 'contract-csrf',
    userAgent: 'Contract/1',
    device: {
      type: 'desktop',
      browser: 'Contract',
      os: 'Test',
      name: 'Contract',
    },
    ip: SIGN_IN_ADDRESS,
    clientId: WEB_CLIENT,
    userVersion: 0,
    clientVersion: 0,
    grantVersion: 0,
    authEpoch: 1,
    schemaVersion: 1,
    scopes: ['api'],
    audience: 'api',
    authenticationMethods: [],
    credentialPurpose: 'browser_session',
    browserGeneration: 1,
    authenticatedAt: at,
    lastUsedAt: at,
    lastActivityAt: at,
    expiresAt: new Date('2099-01-01T14:00:00.000Z'),
    idleExpiresAt: new Date('2099-01-01T12:10:00.000Z'),
  };
}

/** Awaits a promise that must reject and hands back what it rejected with. */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}
