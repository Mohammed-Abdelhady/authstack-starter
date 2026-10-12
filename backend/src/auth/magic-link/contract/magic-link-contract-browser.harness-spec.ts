import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { hashMagicLinkToken } from '../utils/magic-link-token.util';
import {
  LinkBrowser,
  linkBrowser,
  linkServices,
  LinkServices,
  LINK_LIFETIME_MS,
  MagicLinkHarnessSource,
  refusalOf,
} from './magic-link-contract.harness-spec';

const EMAIL = 'link@example.test';
const MASKED = 'l***@example.test';
const NONCE_COOKIE = 'ml_nonce';
const INVALID = 'MAGIC_LINK_INVALID';
const CONTINUATION = '/en/auth/native/authorize?transaction=abc-123';
const CONFIRMATION = {
  requiresTwoFactor: false,
  user: null,
  requiresConfirmation: true,
  email: MASKED,
};

/** A link signs in by itself only in the browser that asked for it. */
export function magicLinkBrowserCases(harness: MagicLinkHarnessSource): void {
  let services: LinkServices;
  let asked: LinkBrowser;
  let accountId: string;

  beforeEach(async () => {
    services = linkServices(harness());
    asked = linkBrowser();
    accountId = await harness().seedAccount({
      email: EMAIL,
      isVerified: true,
      isDeleted: false,
    });
  });

  /** Asks for a link from a browser and hands back the mailed token. */
  const ask = async (
    browser = asked,
    email = EMAIL,
    redirect?: string,
  ): Promise<string> => {
    await services.service.request(
      { email, ...(redirect ? { redirect } : {}) },
      browser.request,
      browser.response,
    );
    return services.mailedToken();
  };
  const open = (token: string, browser: LinkBrowser, confirm?: boolean) =>
    services.service.verify(
      { token, ...(confirm === undefined ? {} : { confirm }) },
      browser.request,
      browser.response,
    );
  const spentAt = async (token: string) =>
    (await harness().link(hashMagicLinkToken(token)))?.consumedAt;

  it('signs in at once in the browser that asked, and takes its nonce back', async () => {
    const token = await ask(asked, EMAIL, CONTINUATION);
    const held = { ...asked.cookies };

    const answer = await open(token, asked);

    expect({
      nonceWasHeld: typeof held[NONCE_COOKIE],
      user: answer.data.user?.id,
      redirect: answer.data.redirect,
      asksToConfirm: answer.data.requiresConfirmation,
      signedIn: services.signedIn,
      spentAt: await spentAt(token),
      cookiesLeft: asked.cookies,
      cleared: asked.cleared,
    }).toEqual({
      nonceWasHeld: 'string',
      user: accountId,
      redirect: CONTINUATION,
      asksToConfirm: undefined,
      signedIn: [accountId],
      spentAt: TEST_NOW,
      cookiesLeft: {},
      cleared: [NONCE_COOKIE],
    });
  });

  it('asks another browser to confirm, with the masked address only, and spends nothing', async () => {
    const token = await ask(asked, EMAIL, CONTINUATION);
    const other = linkBrowser();

    const answer = await open(token, other);

    expect({
      data: { ...answer.data },
      signedIn: services.signedIn,
      spentAt: await spentAt(token),
      cookiesWritten: other.written,
    }).toEqual({
      data: CONFIRMATION,
      signedIn: [],
      spentAt: null,
      cookiesWritten: [],
    });
  });

  it('signs in from another browser once the person confirmed, and only once', async () => {
    const token = await ask(asked, EMAIL, CONTINUATION);
    const other = linkBrowser();
    await open(token, other);

    const confirmed = await open(token, other, true);
    const replayed = await refusalOf(open(token, other, true));
    const replayedWhereItWasAsked = await refusalOf(open(token, asked));

    expect({
      user: confirmed.data.user?.id,
      redirect: confirmed.data.redirect,
      replayed,
      replayedWhereItWasAsked,
      signedIn: services.signedIn,
      spentAt: await spentAt(token),
    }).toEqual({
      user: accountId,
      redirect: CONTINUATION,
      replayed: INVALID,
      replayedWhereItWasAsked: INVALID,
      signedIn: [accountId],
      spentAt: TEST_NOW,
    });
  });

  it('treats confirm sent as false like no confirmation at all', async () => {
    const token = await ask();

    const answer = await open(token, linkBrowser(), false);

    expect({ data: { ...answer.data }, spentAt: await spentAt(token) }).toEqual(
      { data: CONFIRMATION, spentAt: null },
    );
  });

  it('asks a browser that holds the nonce of another request to confirm', async () => {
    const token = await ask();
    const other = linkBrowser();
    await ask(other, 'someone-else@example.test');

    const answer = await open(token, other);

    expect({ data: { ...answer.data }, spentAt: await spentAt(token) }).toEqual(
      { data: CONFIRMATION, spentAt: null },
    );
  });

  it('gives a browser a new nonce in place of one it could not have been given', async () => {
    asked.cookies[NONCE_COOKIE] = 'planted';

    const token = await ask();
    const replaced = asked.cookies[NONCE_COOKIE];
    asked.cookies[NONCE_COOKIE] = 'planted';
    const answer = await open(token, asked);

    expect({
      replaced: replaced === 'planted' ? 'kept' : typeof replaced,
      data: { ...answer.data },
    }).toEqual({ replaced: 'string', data: CONFIRMATION });
  });

  it('keeps one nonce for a browser, so an earlier link of its own still signs in', async () => {
    const earlier = await ask();
    await ask();

    const answer = await open(earlier, asked);

    expect({
      user: answer.data.user?.id,
      nonces: new Set(asked.written.map(({ value }) => value)).size,
    }).toEqual({ user: accountId, nonces: 1 });
  });

  it('asks to confirm a link that was stored without a nonce', async () => {
    await ask();
    await harness().seedLink({
      email: EMAIL,
      tokenHash: hashMagicLinkToken('stored-before-nonces'),
      expiresAt: new Date(TEST_NOW.getTime() + LINK_LIFETIME_MS),
      createdAt: TEST_NOW,
    });

    const answer = await open('stored-before-nonces', asked);

    expect({ ...answer.data }).toEqual(CONFIRMATION);
  });

  it('refuses an unknown, a spent and an expired link without asking anyone to confirm', async () => {
    const spent = await ask();
    await open(spent, asked);
    const other = linkBrowser();
    const unknown = await refusalOf(open('no-such-token', other));
    const spentElsewhere = await refusalOf(open(spent, other));
    const expired = await ask();
    harness().clock.set(new Date(TEST_NOW.getTime() + LINK_LIFETIME_MS));

    expect({
      unknown,
      spent: spentElsewhere,
      expiredElsewhere: await refusalOf(open(expired, other)),
      expiredWhereAsked: await refusalOf(open(expired, asked)),
      expiredConfirmed: await refusalOf(open(expired, other, true)),
      signedIn: services.signedIn,
    }).toEqual({
      unknown: INVALID,
      spent: INVALID,
      expiredElsewhere: INVALID,
      expiredWhereAsked: INVALID,
      expiredConfirmed: INVALID,
      signedIn: [accountId],
    });
  });

  it('accepts a link one millisecond before it expires', async () => {
    const token = await ask();
    harness().clock.set(new Date(TEST_NOW.getTime() + LINK_LIFETIME_MS - 1));

    const answer = await open(token, asked);

    expect(answer.data.user?.id).toBe(accountId);
  });

  it('never replaces the session of another account without a confirmation', async () => {
    const otherAccount = await harness().seedAccount({
      email: 'signed-in@example.test',
      isVerified: true,
      isDeleted: false,
    });
    const token = await ask();
    services.holdSession(asked, otherAccount);
    const session = asked.cookies.sid;

    const answer = await open(token, asked);
    const afterAsking = {
      data: { ...answer.data },
      signedIn: [...services.signedIn],
      spentAt: await spentAt(token),
      session: asked.cookies.sid === session,
    };
    const confirmed = await open(token, asked, true);

    expect({ afterAsking, confirmed: confirmed.data.user?.id }).toEqual({
      afterAsking: {
        data: CONFIRMATION,
        signedIn: [],
        spentAt: null,
        session: true,
      },
      confirmed: accountId,
    });
  });

  it('asks to confirm a link that would create an account while another one is signed in', async () => {
    const token = await ask(asked, 'new@example.test');
    services.holdSession(asked, accountId);

    const answer = await open(token, asked);

    expect({
      data: { ...answer.data },
      accounts: await harness().accountCount(),
    }).toEqual({
      data: { ...CONFIRMATION, email: 'n***@example.test' },
      accounts: 1,
    });
  });

  it('signs in at once when the session in the browser is the link account itself', async () => {
    const token = await ask();
    services.holdSession(asked, accountId);

    const answer = await open(token, asked);

    expect(answer.data.user?.id).toBe(accountId);
  });
}
