import { AppException } from '../../../../src/common/exceptions/app.exception';
import { hashToken } from '../../../../src/session/utils/hashing/token-hash';
import { AsyncMethodName } from '../../race-gate';
import {
  rerunAtOnce,
  SIGN_IN_ADDRESS,
  WEB_CLIENT,
} from '../issuance-contract/issuance-contract-support';
import { AuthorityContractHarness } from './authority-contract-harness';

export type AuthorityHarnessSource = () => AuthorityContractHarness;

export const ABORT_AFTER_EVENT = 'the work was aborted after the event';

export interface SignedIn {
  token: string;
  sessionId: string;
}

/** Signs in through the real service and finds the session it stored. */
export async function signIn(
  harness: AuthorityContractHarness,
  userId: string,
  agent = 'Contract/1',
  clientId = WEB_CLIENT,
): Promise<SignedIn> {
  const issued = await harness.issuance
    .service(rerunAtOnce)
    .createBrowserSession(userId, agent, SIGN_IN_ADDRESS, clientId);
  return {
    token: issued.sessionToken,
    sessionId: await sessionIdOf(harness, userId, issued.sessionToken),
  };
}

export async function sessionIdOf(
  harness: AuthorityContractHarness,
  userId: string,
  token: string,
): Promise<string> {
  const tokenHash = hashToken(token);
  const stored = (await harness.issuance.sessions(userId)).find(
    (session) => session.tokenHash === tokenHash,
  );
  if (!stored) {
    throw new Error('the sign-in stored no session');
  }
  return stored.id;
}

/** Whether a browser credential holds authority now. Never extends it. */
export async function validates(
  harness: AuthorityContractHarness,
  token: string,
): Promise<boolean> {
  return (await harness.validator().validateByToken(token, false)) !== null;
}

/** The error code a refused call answered with, or how it ended otherwise. */
export async function outcomeOf(call: Promise<unknown>): Promise<unknown> {
  try {
    return await call;
  } catch (error) {
    return error instanceof AppException ? error.getCode() : error;
  }
}

type AsyncMethod = (...args: never[]) => Promise<unknown>;

/**
 * Lets the real method run and then fails the caller, so the work is aborted
 * with that write already made inside it. Returns the function that puts the
 * method back.
 */
export function failAfter<
  Service extends object,
  Name extends AsyncMethodName<Service>,
>(service: Service, method: Name, failure: Error): () => void {
  const real: unknown = Reflect.get(service, method);
  if (typeof real !== 'function') {
    throw new Error(`${method} is not a method of the service`);
  }
  const owned = Object.prototype.hasOwnProperty.call(service, method);
  Reflect.defineProperty(service, method, {
    configurable: true,
    writable: true,
    value: async (
      ...args: Parameters<Extract<Service[Name], AsyncMethod>>
    ): Promise<never> => {
      await Reflect.apply(real, service, args);
      throw failure;
    },
  });
  return () => {
    if (owned) {
      Reflect.defineProperty(service, method, {
        configurable: true,
        writable: true,
        value: real,
      });
    } else {
      Reflect.deleteProperty(service, method);
    }
  };
}

/** What is stored for an account and its sessions, to compare in one go. */
export async function storedFor(
  harness: AuthorityContractHarness,
  userId: string,
  sessionIds: string[],
): Promise<{
  accountVersion: number | undefined;
  sessions: Array<{ live: boolean; userVersion: number | undefined }>;
  events: string[];
}> {
  const sessions = await Promise.all(
    sessionIds.map((id) => harness.session(id)),
  );
  return {
    accountVersion: (await harness.issuance.account(userId))?.sessionVersion,
    sessions: sessions.map((session) => ({
      live: Boolean(session?.isValid) && session?.revokedAt === null,
      userVersion: session?.userVersion,
    })),
    events: (await harness.events())
      .filter(({ targetUserId }) => targetUserId === userId)
      .map(({ action }) => action),
  };
}
