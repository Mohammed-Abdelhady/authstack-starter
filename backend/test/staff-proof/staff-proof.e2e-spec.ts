import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { UnitOfWorkRunner } from '../../src/common/persistence/unit-of-work';
import { FreshProofGate } from '../../src/auth/proof/fresh-proof-gate';
import { SessionProofStore } from '../../src/auth/proof/stores/session-proof.store';
import {
  FRESH_PROOF_KIND,
  FRESH_PROOF_REQUIREMENT,
} from '../../src/auth/contracts/constants/fresh-proof';
import type { ActingSession } from '../../src/auth/proof/types/acting-session';
import { Sessions } from '../../src/auth/services/sessions/sessions';
import { ADMIN_CLIENT_ID } from '../../src/session/constants/client-ids';
import { SENSITIVE_ACTION_WINDOW_MS } from '../../src/session/constants/session-policy';
import type { IssuedBrowserSession } from '../../src/session/services/session-issuance.service';
import { SEED_ADMIN } from '../constants/seed-users';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import {
  ADMIN_ORIGIN,
  arrangeAudiences,
  audienceRequest,
  issueAudienceBrowser,
} from '../utils/audience-authorization.fixtures';
import { storeBrowserPolicy } from '../utils/session/store-browser-policy';

type ProofReply = { provedAt: string };
const ROUTES = {
  code: '/api/auth/proof/code',
  verify: '/api/auth/proof/code/verify',
} as const;

describe('staff session fresh proof', () => {
  let e2e: E2eApp;
  let issued: IssuedBrowserSession;
  let session: ActingSession;

  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      beforeStart: (app) =>
        app.get(ConfigService).set('cors.adminUrl', ADMIN_ORIGIN),
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    const fixture = await arrangeAudiences(e2e, ['*']);
    issued = await issueAudienceBrowser(e2e, fixture.adminId);
    session = await facts(issued);
  });

  async function facts(browser: IssuedBrowserSession): Promise<ActingSession> {
    const validated = await e2e.app
      .get(Sessions)
      .validateSessionWithoutExtendingIdle(browser.sessionToken);
    if (!validated?.user) throw new Error('staff session is missing');
    return {
      sessionId: validated.id,
      userId: validated.userId,
      clientId: validated.clientId,
      signedInAt: validated.authenticatedAt,
    };
  }

  function assertFresh(acting = session): Promise<void> {
    return e2e.app
      .get(UnitOfWorkRunner)
      .run((work) =>
        e2e.app
          .get(FreshProofGate)
          .assertFresh(work, acting, FRESH_PROOF_REQUIREMENT.ACT),
      );
  }

  async function sendCode(): Promise<string> {
    const response = await audienceRequest(e2e, issued, ROUTES.code, 'post')
      .send({})
      .expect(200);
    expect(response.body).toEqual({ expiresInMinutes: 10 });
    const mail = await e2e.captureMail();
    expect(mail.at(-1)?.to).toBe(SEED_ADMIN.email);
    return e2e.mailedCode();
  }

  // Failure: proof signs in again, changes session identity, or authorizes after five minutes.
  it('proves only the existing session for five minutes with its own mailed code', async () => {
    await expect(assertFresh()).rejects.toMatchObject({
      code: ErrorCode.REAUTH_REQUIRED,
    });
    const before = await e2e.state.sessions.countSessions();
    const code = await sendCode();
    const response = await audienceRequest(e2e, issued, ROUTES.verify, 'post')
      .send({ code })
      .expect(200);
    expect((response.body as ProofReply).provedAt).toBe(TEST_NOW.toISOString());
    expect(await facts(issued)).toEqual(session);
    expect(await e2e.state.sessions.countSessions()).toBe(before);
    expect(response.headers['set-cookie']).toBeUndefined();
    const replay = await audienceRequest(e2e, issued, ROUTES.verify, 'post')
      .send({ code })
      .expect(401);
    expect(replay.body).toMatchObject({
      error: { code: ErrorCode.EMAIL_CODE_INVALID },
    });
    await expect(assertFresh()).resolves.toBeUndefined();
    e2e.clock.advance(SENSITIVE_ACTION_WINDOW_MS);
    await expect(assertFresh()).resolves.toBeUndefined();
    e2e.clock.advance(1);
    await expect(assertFresh()).rejects.toMatchObject({
      code: ErrorCode.REAUTH_REQUIRED,
    });
  });

  // Failure: throwing on a wrong answer rolls back guesses and allows unlimited attempts.
  it('ends the code after five wrong answers even when the correct answer is then supplied', async () => {
    const code = await sendCode();
    const wrong = code === '000000' ? '000001' : '000000';
    for (let guess = 0; guess < 5; guess += 1) {
      const response = await audienceRequest(e2e, issued, ROUTES.verify, 'post')
        .send({ code: wrong })
        .expect(401);
      expect(response.body).toMatchObject({
        error: { code: ErrorCode.EMAIL_CODE_INVALID },
      });
      if (guess < 4) {
        const challenge = await e2e.app
          .get(UnitOfWorkRunner)
          .run((work) =>
            e2e.app
              .get(SessionProofStore)
              .takeChallenge(work, session, FRESH_PROOF_KIND.EMAIL_CODE),
          );
        expect(challenge?.wrongGuesses).toBe(guess + 1);
      }
    }
    const refused = await audienceRequest(e2e, issued, ROUTES.verify, 'post')
      .send({ code })
      .expect(401);
    expect(refused.body).toMatchObject({
      error: { code: ErrorCode.EMAIL_CODE_INVALID },
    });
    await expect(assertFresh()).rejects.toMatchObject({
      code: ErrorCode.REAUTH_REQUIRED,
    });
  });

  // Failure: account-global proof authorizes a second session of the same staff account.
  it('does not let another session consume or inherit the first session proof', async () => {
    const other = await issueAudienceBrowser(e2e, session.userId);
    const otherSession = await facts(other);
    expect(otherSession.sessionId).not.toBe(session.sessionId);
    const code = await sendCode();
    const refused = await audienceRequest(e2e, other, ROUTES.verify, 'post')
      .send({ code })
      .expect(401);
    expect(refused.body).toMatchObject({
      error: { code: ErrorCode.EMAIL_CODE_INVALID },
    });
    await audienceRequest(e2e, issued, ROUTES.verify, 'post')
      .send({ code })
      .expect(200);
    await expect(assertFresh()).resolves.toBeUndefined();
    await expect(assertFresh(otherSession)).rejects.toMatchObject({
      code: ErrorCode.REAUTH_REQUIRED,
    });
  });

  // Failure: a required-passkey console offers or accepts a weaker mailed proof.
  it('refuses code issuance and a previously mailed code when passkey proof is required', async () => {
    const code = await sendCode();
    await storeBrowserPolicy(
      e2e,
      ADMIN_CLIENT_ID,
      { requirePasskey: true },
      false,
    );
    const before = (await e2e.captureMail()).length;
    for (const path of [ROUTES.code, ROUTES.verify]) {
      const response = await audienceRequest(e2e, issued, path, 'post')
        .send({ code })
        .expect(403);
      expect(response.body).toMatchObject({
        error: { code: ErrorCode.FEATURE_DISABLED },
      });
    }
    expect((await e2e.captureMail()).length).toBe(before);
    await expect(assertFresh()).rejects.toMatchObject({
      code: ErrorCode.REAUTH_REQUIRED,
    });
  });
});
