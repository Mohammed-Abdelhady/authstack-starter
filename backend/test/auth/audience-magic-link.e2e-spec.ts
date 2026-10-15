// feature:magic-link:start
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { ADMIN_CLIENT_ID } from '../../src/session/constants/client-ids';
import { MagicLinkStore } from '../../src/auth/magic-link/stores/magic-link.store';
import { hashMagicLinkToken } from '../../src/auth/magic-link/utils/magic-link-token.util';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import { bootE2eApp, type E2eApp, type TestAgent } from '../utils/e2e-app';
import {
  ADMIN_ORIGIN,
  arrangeAudiences,
} from '../utils/audience-authorization.fixtures';
import {
  addressReply,
  anonymousPost,
  expectNoAuthority,
  reply,
} from '../utils/auth/audience-refusal.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const REQUEST = '/api/auth/magic-link/request';
const VERIFY = '/api/auth/magic-link/verify';
const UNKNOWN_EMAIL = 'closed-admin-link@example.test';
const BAD_TOKEN = `${ADMIN_CLIENT_ID}.${'a'.repeat(43)}`;

// Failure: a closed link creates staff or audience refusal spends a valid link.
describe('closed admin magic links', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      magicLinkEnabled: true,
      beforeStart: (app) =>
        app.get(ConfigService).set('cors.adminUrl', ADMIN_ORIGIN),
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  beforeEach(async () => {
    await arrangeAudiences(e2e);
  });
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  async function ask(browser: TestAgent, email: string) {
    const response = await anonymousPost(e2e, REQUEST, { email }, browser);
    const mail = await e2e.captureMail();
    const link = mail.at(-1)?.text?.match(/https?:\/\/[^\s]+/u)?.[0];
    const token = link ? new URL(link).searchParams.get('token') : null;
    if (!token) throw new Error('magic-link request sent no token');
    return { response, token, mailCount: mail.length };
  }

  it('mails both addresses but only signs the known staff account in', async () => {
    const knownBrowser = request.agent(e2e.httpServer);
    const known = await ask(knownBrowser, SEED_ADMIN.email);
    const unknownBrowser = request.agent(e2e.httpServer);
    const unknown = await ask(unknownBrowser, UNKNOWN_EMAIL);
    expect(addressReply(unknown.response)).toEqual(
      addressReply(known.response),
    );
    expect(known.response.status).toBe(200);
    expect(known.mailCount).toBe(1);
    expect(unknown.mailCount - known.mailCount).toBe(1);
    const wrong = await anonymousPost(
      e2e,
      VERIFY,
      { token: BAD_TOKEN, confirm: true },
      unknownBrowser,
    );
    const refused = await anonymousPost(
      e2e,
      VERIFY,
      { token: unknown.token, confirm: true },
      unknownBrowser,
    );
    expect(reply(refused)).toEqual(reply(wrong));
    expect(wrong.status).toBe(400);
    expectNoAuthority(e2e, refused);
    expect(await e2e.state.accounts.accountIdFor(UNKNOWN_EMAIL)).toBeNull();
    expect(await e2e.state.sessions.countSessions()).toBe(0);
    const signedIn = await anonymousPost(
      e2e,
      VERIFY,
      { token: known.token, confirm: true },
      knownBrowser,
    );
    expect(signedIn.status).toBe(200);
    expect(signedIn.body).toMatchObject({
      data: { user: { email: SEED_ADMIN.email } },
    });
    expect(await e2e.state.sessions.countSessions()).toBe(1);
  });

  it.each([false, true])(
    'refuses an excluded customer link without spending it, confirm %s',
    async (confirm) => {
      const issued = await ask(request.agent(e2e.httpServer), SEED_USER.email);
      const browser = request.agent(e2e.httpServer);
      const links = e2e.app.get(MagicLinkStore);
      const hash = hashMagicLinkToken(issued.token);
      const before = await links.findUnspentLink(hash);
      expect(before?.email).toBe(SEED_USER.email);
      const wrong = await anonymousPost(
        e2e,
        VERIFY,
        { token: BAD_TOKEN, confirm },
        browser,
      );
      const refused = await anonymousPost(
        e2e,
        VERIFY,
        { token: issued.token, confirm },
        browser,
      );
      expect(reply(refused)).toEqual(reply(wrong));
      expect(wrong.status).toBe(400);
      expectNoAuthority(e2e, refused);
      expect(await links.findUnspentLink(hash)).toEqual(before);
      expect(await e2e.state.sessions.countSessions()).toBe(0);
    },
  );
});
// feature:magic-link:end
