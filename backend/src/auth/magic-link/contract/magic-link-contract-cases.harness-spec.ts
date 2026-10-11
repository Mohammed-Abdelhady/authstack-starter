import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { hashMagicLinkToken } from '../utils/magic-link-token.util';
import {
  LINK_REQUEST,
  linkServices,
  LinkServices,
  LINKS_PER_HOUR,
  MagicLinkHarnessSource,
  ONE_HOUR_MS,
} from './magic-link-contract.harness-spec';

const EMAIL = 'link@example.test';
const TOKEN = 'a-token-from-the-mailed-link';
const LINK_EXPIRY = new Date('2099-01-01T12:15:00.000Z');
const REQUEST_CALLS = [
  'accounts.findByEmail',
  'links.countRequestedSince',
  'links.insertLink',
];

/** Requesting a link and the hourly cap. */
export function magicLinkCases(harness: MagicLinkHarnessSource): void {
  let services: LinkServices;

  beforeEach(() => {
    services = linkServices(harness());
  });

  const request = (email = EMAIL) =>
    services.service.request({ email }, LINK_REQUEST);
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

  it('stores the hash of the mailed token, unspent, for one link lifetime', async () => {
    const answer = await request();
    const token = services.mailedToken();
    const stored = await harness().link(hashMagicLinkToken(token));

    expect({
      answered: answer.data.email,
      mails: services.mail.map(({ to }) => to),
      stored,
      tokenIsNotStored: (await harness().link(token)) === null,
      calls: services.storeCalls,
    }).toEqual({
      answered: EMAIL,
      mails: [EMAIL],
      stored: {
        email: EMAIL,
        tokenHash: hashMagicLinkToken(token),
        expiresAt: LINK_EXPIRY,
        consumedAt: null,
        requestIp: '127.0.0.1',
        userAgent: 'Contract/1',
        redirect: null,
      },
      tokenIsNotStored: true,
      calls: REQUEST_CALLS,
    });
  });

  it('answers and works the same for an address with an account and one without', async () => {
    await harness().seedAccount({
      email: 'known@example.test',
      isVerified: true,
      isDeleted: false,
    });

    const known = await request('known@example.test');
    const knownCalls = [...services.storeCalls];
    services.storeCalls.length = 0;
    const unknown = await request('unknown@example.test');

    expect({
      sameMessage: known.message === unknown.message,
      knownCalls,
      unknownCalls: services.storeCalls,
      mails: services.mail.length,
      links: await harness().linkCount(),
    }).toEqual({
      sameMessage: true,
      knownCalls: REQUEST_CALLS,
      unknownCalls: REQUEST_CALLS,
      mails: 2,
      links: 2,
    });
  });

  it('stores and mails nothing for a deleted account', async () => {
    await harness().seedAccount({
      email: EMAIL,
      isVerified: true,
      isDeleted: true,
    });

    const answer = await request();

    expect({
      answered: answer.data.email,
      mails: services.mail.length,
      links: await harness().linkCount(),
      calls: services.storeCalls,
    }).toEqual({
      answered: EMAIL,
      mails: 0,
      links: 0,
      calls: ['accounts.findByEmail'],
    });
  });

  it('refuses a link over the hourly cap, counting spent and expired links, and mails nothing', async () => {
    const hourAgo = new Date(TEST_NOW.getTime() - ONE_HOUR_MS);
    await seedLink({ tokenHash: 'at-the-edge', createdAt: hourAgo });
    await seedLink({ tokenHash: 'spent', consumedAt: TEST_NOW });
    await seedLink({ tokenHash: 'expired', expiresAt: hourAgo });
    await seedLink({ tokenHash: 'fourth' });
    await seedLink({ tokenHash: 'fifth' });

    const answer = await request();

    expect({
      answered: answer.data.email,
      mails: services.mail.length,
      links: await harness().linkCount(),
      calls: services.storeCalls,
    }).toEqual({
      answered: EMAIL,
      mails: 0,
      links: LINKS_PER_HOUR,
      calls: ['accounts.findByEmail', 'links.countRequestedSince'],
    });
  });

  it('does not count a link older than an hour or one for another address', async () => {
    const justOlder = new Date(TEST_NOW.getTime() - ONE_HOUR_MS - 1);
    await seedLink({ tokenHash: 'older', createdAt: justOlder });
    await seedLink({ tokenHash: 'second' });
    await seedLink({ tokenHash: 'third' });
    await seedLink({ tokenHash: 'fourth' });
    await seedLink({ tokenHash: 'fifth' });
    await harness().seedLink({
      email: 'other@example.test',
      tokenHash: 'other',
      expiresAt: LINK_EXPIRY,
      createdAt: TEST_NOW,
    });

    await request();

    expect({
      mails: services.mail.length,
      links: await harness().linkCount(),
    }).toEqual({ mails: 1, links: 7 });
  });
}
