import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { UniqueConflictError } from '../../../common/persistence/persistence-errors';
import { hashMagicLinkToken } from '../utils/magic-link-token.util';
import {
  LINK_REQUEST,
  LINK_RESPONSE,
  linkServices,
  LinkServices,
  MagicLinkHarnessSource,
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
    services.service.request({ email }, LINK_REQUEST, LINK_RESPONSE);
  const verify = (token = TOKEN) =>
    services.service.verify(
      { token, confirm: true },
      LINK_REQUEST,
      LINK_RESPONSE,
    );
  it('refuses a second link with one token hash and a second account with one address as unique conflicts', async () => {
    const link = { email: EMAIL, tokenHash: 'same', expiresAt: LINK_EXPIRY };
    const account = {
      audience: undefined,
      email: EMAIL,
      name: 'link',
      locale: 'en' as const,
    };
    await harness().links.insertLink(link);
    await harness().runner.run((work) =>
      harness().accounts.createPasswordlessIn(work, account),
    );

    expect({
      link: await conflictOf(harness().links.insertLink(link)),
      account: await conflictOf(
        harness().runner.run((work) =>
          harness().accounts.createPasswordlessIn(work, account),
        ),
      ),
      links: await harness().linkCount(),
      accounts: await harness().accountCount(),
    }).toEqual({
      link: 'pending_magic_link.token_hash',
      account: 'user.email',
      links: 1,
      accounts: 1,
    });
  });

  it('stores an address trimmed and in lower case and finds it by either form', async () => {
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
  });

  // Failure: a stale refusal reopens a link consumed by a later request.
  it('restores only the link claim with the exact claimed timestamp', async () => {
    const h = harness();
    const tokenHash = hashMagicLinkToken(TOKEN);
    const firstClaim = TEST_NOW;
    const laterClaim = new Date(firstClaim.getTime() + 1);
    await h.seedLink({
      email: EMAIL,
      tokenHash,
      expiresAt: LINK_EXPIRY,
      createdAt: TEST_NOW,
    });
    expect(await h.links.claimLink(tokenHash, firstClaim)).not.toBeNull();
    expect(await h.links.restoreUnspentLink(tokenHash, laterClaim)).toBe(false);
    expect(await h.links.findUnspentLink(tokenHash)).toBeNull();
    expect((await h.link(tokenHash))?.consumedAt).toEqual(firstClaim);
    expect(await h.links.restoreUnspentLink(tokenHash, firstClaim)).toBe(true);
    expect(await h.links.findUnspentLink(tokenHash)).toMatchObject({
      email: EMAIL,
    });
    expect(await h.links.claimLink(tokenHash, laterClaim)).not.toBeNull();
    expect(await h.links.restoreUnspentLink(tokenHash, firstClaim)).toBe(false);
    expect(await h.links.findUnspentLink(tokenHash)).toBeNull();
    expect((await h.link(tokenHash))?.consumedAt).toEqual(laterClaim);
  });
}
