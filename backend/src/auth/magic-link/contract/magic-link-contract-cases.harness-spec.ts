import { hashMagicLinkToken } from '../utils/magic-link-token.util';
import {
  LINK_REQUEST,
  LINK_RESPONSE,
  linkServices,
  LinkServices,
  MagicLinkHarnessSource,
} from './magic-link-contract.harness-spec';

const EMAIL = 'link@example.test';
const LINK_EXPIRY = new Date('2099-01-01T12:15:00.000Z');
const REQUEST_CALLS = [
  'accounts.findLinkRecipient',
  'links.takeRequestSlot',
  'links.insertLink',
];

/** Requesting a link. The cap and the paths that mail nothing are in the cap cases. */
export function magicLinkCases(harness: MagicLinkHarnessSource): void {
  let services: LinkServices;

  beforeEach(() => {
    services = linkServices(harness());
  });

  const request = (email = EMAIL) =>
    services.service.request({ email }, LINK_REQUEST, LINK_RESPONSE);

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
}
