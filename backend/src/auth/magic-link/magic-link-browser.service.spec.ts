import { ConfigService } from '@nestjs/config';
import { partialMock } from '../../common/testing/test-doubles.harness-spec';
import { SessionCookieService } from '../services/sessions/session-cookie.service';
import { Sessions } from '../services/sessions/sessions';
import { linkBrowser } from './contract/magic-link-contract.harness-spec';
import { MagicLinkBrowserService } from './magic-link-browser.service';
import { hashMagicLinkToken } from './utils/magic-link-token.util';

const LINK_LIFETIME_MS = 600_000;
const A_NONCE = 'A'.repeat(43);

function browserService(nodeEnv: string): MagicLinkBrowserService {
  const config = new ConfigService({
    NODE_ENV: nodeEnv,
    magicLink: { expiresIn: LINK_LIFETIME_MS },
  });
  return new MagicLinkBrowserService(
    partialMock<Sessions>({}),
    new SessionCookieService(config),
    config,
  );
}

describe('MagicLinkBrowserService', () => {
  it('leaves a host-only cookie no script and no other site can use, for one link lifetime', () => {
    const browser = linkBrowser();

    const hash = browserService('development').bind(
      browser.request,
      browser.response,
    );
    const [written] = browser.written;

    expect({
      name: written?.name,
      options: written?.options,
      hashIsOfTheNonce: hash === hashMagicLinkToken(written?.value ?? ''),
      nonceLength: written?.value.length,
    }).toEqual({
      name: 'ml_nonce',
      options: {
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        path: '/',
        maxAge: LINK_LIFETIME_MS,
      },
      hashIsOfTheNonce: true,
      nonceLength: 43,
    });
  });

  it('prefixes the cookie and marks it secure in production', () => {
    const browser = linkBrowser();

    browserService('production').bind(browser.request, browser.response);
    const [written] = browser.written;

    expect({
      name: written?.name,
      secure: written?.options.secure,
      domain: written?.options.domain,
    }).toEqual({ name: '__Host-ml_nonce', secure: true, domain: undefined });
  });

  it('keeps a nonce the browser already holds and mints one for anything else', () => {
    const service = browserService('development');
    const holding = linkBrowser();
    holding.cookies.ml_nonce = A_NONCE;
    const tooShort = linkBrowser();
    tooShort.cookies.ml_nonce = 'A'.repeat(42);
    const wrongAlphabet = linkBrowser();
    wrongAlphabet.cookies.ml_nonce = `${'A'.repeat(42)}!`;

    service.bind(holding.request, holding.response);
    service.bind(tooShort.request, tooShort.response);
    service.bind(wrongAlphabet.request, wrongAlphabet.response);

    expect({
      kept: holding.written[0]?.value,
      tooShortKept: tooShort.written[0]?.value === 'A'.repeat(42),
      wrongAlphabetKept: wrongAlphabet.written[0]?.value.endsWith('!'),
    }).toEqual({
      kept: A_NONCE,
      tooShortKept: false,
      wrongAlphabetKept: false,
    });
  });

  it('reads the hash of a held nonce and nothing from a browser without one', () => {
    const service = browserService('development');
    const holding = linkBrowser();
    holding.cookies.ml_nonce = A_NONCE;
    const malformed = linkBrowser();
    malformed.cookies.ml_nonce = 'planted';

    expect({
      held: service.presentedNonceHash(holding.request),
      none: service.presentedNonceHash(linkBrowser().request),
      malformed: service.presentedNonceHash(malformed.request),
    }).toEqual({
      held: '0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a',
      none: null,
      malformed: null,
    });
  });

  it('clears the cookie with the attributes it was set with', () => {
    const clearCookie = jest.fn();
    const browser = linkBrowser();
    browser.response.clearCookie = clearCookie;

    browserService('production').release(browser.response);

    expect(clearCookie.mock.calls).toEqual([
      [
        '__Host-ml_nonce',
        { httpOnly: true, secure: true, sameSite: 'strict', path: '/' },
      ],
    ]);
  });

  it('names nobody when the browser has no session or a dead one', async () => {
    const config = new ConfigService({});
    const service = new MagicLinkBrowserService(
      partialMock<Sessions>({
        validateSessionWithoutExtendingIdle: () => Promise.resolve(null),
      }),
      new SessionCookieService(config),
      config,
    );
    const dead = linkBrowser();
    dead.cookies.sid = 'a-session-that-ended';

    expect({
      none: await service.sessionAccountId(linkBrowser().request),
      dead: await service.sessionAccountId(dead.request),
    }).toEqual({ none: null, dead: null });
  });
});
