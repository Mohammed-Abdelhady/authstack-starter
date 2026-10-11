import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { UniqueConflictError } from '../../../common/persistence/persistence-errors';
import { hashMagicLinkToken } from '../utils/magic-link-token.util';
import {
  LINK_REQUEST,
  LINK_RESPONSE,
  linkServices,
  LinkServices,
  MAGIC_LINK_CONTRACT_CASE_TIMEOUT_MS,
  MagicLinkHarnessSource,
  ONE_HOUR_MS,
} from './magic-link-contract.harness-spec';

const EMAIL = 'link@example.test';
const TOKEN = 'a-token-from-the-mailed-link';
const LINK_EXPIRY = new Date('2099-01-01T12:15:00.000Z');

async function conflictOf(attempt: Promise<unknown>): Promise<string | null> {
  try {
    await attempt;
  } catch (error) {
    return error instanceof UniqueConflictError ? error.constraint : null;
  }
  return null;
}

/** What the link ports promise: shared errors, addresses and cleanup. */
export function magicLinkSeamCases(harness: MagicLinkHarnessSource): void {
  let services: LinkServices;

  beforeEach(() => {
    services = linkServices(harness());
  });

  const request = (email = EMAIL) =>
    services.service.request({ email }, LINK_REQUEST);
  const verify = (token = TOKEN) =>
    services.service.verify({ token }, LINK_RESPONSE);
  const seedLink = (
    overrides: {
      tokenHash?: string;
      expiresAt?: Date;
      createdAt?: Date;
      consumedAt?: Date;
      redirect?: string;
    } = {},
  ) =>
    harness().seedLink({
      email: EMAIL,
      tokenHash: hashMagicLinkToken(TOKEN),
      expiresAt: LINK_EXPIRY,
      createdAt: TEST_NOW,
      ...overrides,
    });

  it(
    'refuses a second link with one token hash and a second account with one address as unique conflicts',
    async () => {
      const link = { email: EMAIL, tokenHash: 'same', expiresAt: LINK_EXPIRY };
      const account = { email: EMAIL, name: 'link' };
      await harness().links.insertLink(link);
      await harness().accounts.createPasswordless(account);

      expect({
        link: await conflictOf(harness().links.insertLink(link)),
        account: await conflictOf(
          harness().accounts.createPasswordless(account),
        ),
        links: await harness().linkCount(),
        accounts: await harness().accountCount(),
      }).toEqual({
        link: 'pending_magic_link.token_hash',
        account: 'user.email',
        links: 1,
        accounts: 1,
      });
    },
    MAGIC_LINK_CONTRACT_CASE_TIMEOUT_MS,
  );

  it(
    'stores an address trimmed and in lower case and finds it by either form',
    async () => {
      const typed = '  Mixed.Case@Example.Test ';
      const storedForm = 'mixed.case@example.test';

      await request(typed);
      await verify(services.mailedToken());

      expect({
        link: (await harness().link(hashMagicLinkToken(services.mailedToken())))
          ?.email,
        account: (await harness().account(storedForm))?.id,
        signedIn: services.signedIn.length,
      }).toEqual({
        link: storedForm,
        account: services.signedIn[0],
        signedIn: 1,
      });
    },
    MAGIC_LINK_CONTRACT_CASE_TIMEOUT_MS,
  );

  it(
    'removes only the links that expired at or before the cutoff',
    async () => {
      const cutoff = new Date(TEST_NOW.getTime() - ONE_HOUR_MS);
      const created = new Date(TEST_NOW.getTime() - 1000);
      await seedLink({
        tokenHash: 'before',
        expiresAt: new Date(cutoff.getTime() - 1),
        createdAt: created,
      });
      await seedLink({
        tokenHash: 'at',
        expiresAt: cutoff,
        createdAt: created,
      });
      await seedLink({
        tokenHash: 'after',
        expiresAt: new Date(cutoff.getTime() + 1),
        createdAt: created,
      });

      const removed = await harness().links.deleteExpiredBefore(cutoff);

      expect({
        removed,
        before: await harness().link('before'),
        at: await harness().link('at'),
        after: (await harness().link('after'))?.tokenHash,
      }).toEqual({
        removed: 2,
        before: null,
        at: null,
        after: 'after',
      });
    },
    MAGIC_LINK_CONTRACT_CASE_TIMEOUT_MS,
  );
}
