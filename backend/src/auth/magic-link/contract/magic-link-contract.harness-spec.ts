import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { AddressLedger } from '../../../common/persistence/address-ledger';
import { AccountCreationPolicy } from '../../services/registration/account-creation-policy';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { recorded } from '../../../../test/utils/auth/pending-codes-contract/pending-codes-contract-support';
import { FrozenClock } from '../../../../test/utils/frozen-clock';
import {
  createRequestMock,
  createResponseMock,
  partialMock,
} from '../../../common/testing/test-doubles.harness-spec';
import { MailDispatcherService } from '../../../mail/mail-dispatcher.service';
import { MailOptions } from '../../../mail/interfaces/mail-options.interface';
import { MailService } from '../../../mail/mail.service';
import { AuthMailService } from '../../services/mail/auth-mail.service';
import { AuthenticatedSession } from '../../../session/authority/authenticated-session';
import { AccountIdentity } from '../../../session/authority/session-authority.store';
import { SessionCookieService } from '../../services/sessions/session-cookie.service';
import { Sessions } from '../../services/sessions/sessions';
import { MagicLinkBrowserService } from '../magic-link-browser.service';
import { MagicLinkService } from '../magic-link.service';
import {
  MagicLinkAccount,
  MagicLinkAccounts,
  MagicLinkSignIn,
  MagicLinkSignInOutcome,
} from '../stores/magic-link-accounts';
import { MagicLinkStore, NewMagicLink } from '../stores/magic-link.store';

/** Written out, so a changed constant cannot agree with itself. */
export const LINK_LIFETIME_MS = 900_000;
export const LINKS_PER_HOUR = 5;
export const ONE_HOUR_MS = 3_600_000;

export interface SeedLink {
  email: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  consumedAt?: Date;
  redirect?: string;
}

export interface StoredLink {
  email: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  requestIp: string | null;
  userAgent: string | null;
  redirect: string | null;
}

export interface StoredLinkAccount {
  id: string;
  name: string | null;
  isVerified: boolean;
  isDeleted: boolean;
  authProvider: string | null;
}

/**
 * What one database gives the shared link cases: the adapters under test and
 * plain reads and writes of stored rows that go around them.
 */
export interface MagicLinkContractHarness {
  readonly clock: FrozenClock;
  readonly links: MagicLinkStore;
  readonly accounts: MagicLinkAccounts;
  readonly runner: UnitOfWorkRunner;
  readonly ledger: AddressLedger;

  seedLink(link: SeedLink): Promise<void>;
  link(tokenHash: string): Promise<StoredLink | null>;
  linkCount(): Promise<number>;

  seedAccount(account: {
    email: string;
    isVerified: boolean;
    isDeleted: boolean;
  }): Promise<string>;
  /** Looked up by the stored form of the address. */
  account(email: string): Promise<StoredLinkAccount | null>;
  accountCount(): Promise<number>;
  claimCount(): Promise<number>;

  reset(): Promise<void>;
  close(): Promise<void>;
}

export type MagicLinkHarnessSource = () => MagicLinkContractHarness;

const SUMMARY = {
  email: 'signed-in@example.test',
  name: 'Signed In',
  role: 'user',
  authProvider: 'email',
  isVerified: true,
  permissions: [],
};

/**
 * Stands where the shared sign-in stands. Sessions move behind the seam in a
 * later step, so the link cases only record which account was handed over.
 */
class RecordingSignIn extends MagicLinkSignIn {
  readonly accountIds: string[] = [];

  complete(account: MagicLinkAccount): Promise<MagicLinkSignInOutcome> {
    this.accountIds.push(account.id);
    return Promise.resolve({
      requiresTwoFactor: false,
      user: { ...SUMMARY, id: account.id },
    });
  }
}

export interface LinkServices {
  service: MagicLinkService;
  /** Every mail handed to the transport, which never connects. */
  mail: MailOptions[];
  /** Accounts handed to sign-in, in order. */
  signedIn: string[];
  /** Every store call the service made, in order. */
  storeCalls: string[];
  /** The token hash of every link the service stored, in order. */
  storedHashes: string[];
  /** Mails the transport finished, which takes one turn of the event loop. */
  finishedMail(): number;
  /** Waits for every mail the service started. */
  settleMail(): Promise<void>;
  /** The token the last mail carried in its link. */
  mailedToken(): string;
  /** Signs this browser in to the account, as a session cookie would. */
  holdSession(browser: LinkBrowser, accountId: string): void;
}

/** What a browser was told to store, as the response wrote it. */
export interface CookieWrite {
  name: string;
  value: string;
  options: CookieOptions;
}

/** One browser: the cookies it holds and the request and response that carry them. */
export interface LinkBrowser {
  readonly cookies: Record<string, string>;
  readonly written: CookieWrite[];
  readonly cleared: string[];
  readonly request: Request;
  readonly response: Response;
}

export function linkBrowser(): LinkBrowser {
  const cookies: Record<string, string> = {};
  const written: CookieWrite[] = [];
  const cleared: string[] = [];
  const response: Response = createResponseMock({
    cookie: (name: string, value: string, options: CookieOptions) => {
      cookies[name] = value;
      written.push({ name, value, options });
      return response;
    },
    clearCookie: (name: string) => {
      Reflect.deleteProperty(cookies, name);
      cleared.push(name);
      return response;
    },
  });
  return {
    cookies,
    written,
    cleared,
    request: createRequestMock({
      ip: '127.0.0.1',
      headers: { 'user-agent': 'Contract/1' },
      cookies,
    }),
    response,
  };
}

export const LINK_REQUEST: Request = createRequestMock({
  ip: '127.0.0.1',
  headers: { 'user-agent': 'Contract/1' },
});

/** A response whose cookies nobody keeps: the next call comes from elsewhere. */
export const LINK_RESPONSE: Response = linkBrowser().response;

/** The name the session cookie has under the contract's configuration. */
export const SESSION_COOKIE = 'sid';

/** The real service on one database's adapters, with mail kept in memory. */
export function linkServices(
  harness: Pick<
    MagicLinkContractHarness,
    'clock' | 'links' | 'accounts' | 'runner' | 'ledger'
  >,
  policy: AccountCreationPolicy = new AccountCreationPolicy(),
): LinkServices {
  const config = new ConfigService({
    magicLink: { expiresIn: LINK_LIFETIME_MS, maxPerHour: LINKS_PER_HOUR },
    cors: { clientUrl: 'http://localhost:3000' },
    smtp: { from: 'contract@example.test' },
  });
  const mail: MailOptions[] = [];
  const mailService = new MailService(config);
  let finished = 0;
  mailService.sendMail = async (options: MailOptions): Promise<void> => {
    mail.push(options);
    // A transport answers later than the code that called it.
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    finished += 1;
  };
  const dispatcher = new MailDispatcherService(config, mailService);
  const authMail = new AuthMailService(mailService, dispatcher);
  const signIn = new RecordingSignIn();
  const sessionAccounts = new Map<string, string>();
  const sessions = partialMock<Sessions>({
    validateSessionWithoutExtendingIdle: (token: string) => {
      const id = sessionAccounts.get(token);
      return Promise.resolve(
        id === undefined
          ? null
          : partialMock<AuthenticatedSession>({
              user: partialMock<AccountIdentity>({ id }),
            }),
      );
    },
  });
  const storeCalls: string[] = [];
  const storedHashes: string[] = [];
  const links = new Proxy(harness.links, {
    get(target, property) {
      if (property !== 'insertLink') {
        return Reflect.get(target, property, target) as unknown;
      }
      return (link: NewMagicLink): Promise<void> => {
        storedHashes.push(link.tokenHash);
        return target.insertLink(link);
      };
    },
  });

  return {
    service: new MagicLinkService(
      recorded(links, 'links', storeCalls),
      recorded(harness.accounts, 'accounts', storeCalls),
      config,
      authMail,
      dispatcher,
      signIn,
      new MagicLinkBrowserService(
        sessions,
        new SessionCookieService(config),
        config,
      ),
      harness.clock,
      policy,
      harness.ledger,
      harness.runner,
    ),
    mail,
    signedIn: signIn.accountIds,
    storeCalls,
    storedHashes,
    finishedMail: () => finished,
    settleMail: () => dispatcher.flush(),
    holdSession: (browser, accountId) => {
      const token = `session-of-${accountId}`;
      sessionAccounts.set(token, accountId);
      browser.cookies[SESSION_COOKIE] = token;
    },
    mailedToken: () => {
      const last = mail[mail.length - 1];
      const token = /token=([A-Za-z0-9_-]+)/.exec(last?.text ?? '')?.[1];
      if (!token) {
        throw new Error('the last mail carried no link token');
      }
      return token;
    },
  };
}

/** The application error code of a rejection, or the error's own name. */
function codeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'getCode' in error) {
    const getCode: unknown = error.getCode;
    if (typeof getCode === 'function') {
      return String(Reflect.apply(getCode, error, []));
    }
  }
  return error instanceof Error ? error.name : typeof error;
}

/** Awaits a promise that must reject and hands back its application code. */
export async function refusalOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return codeOf(error);
  }
  throw new Error('expected a rejection');
}

/** How one use of a link ended: signed in, or the code it was refused with. */
export async function useOutcome(use: Promise<unknown>): Promise<string> {
  try {
    await use;
  } catch (error) {
    return codeOf(error);
  }
  return 'signed in';
}
