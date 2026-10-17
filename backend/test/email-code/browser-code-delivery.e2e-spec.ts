import { EmailCodeStore } from '../../src/auth/pending-codes/email-code.store';
import { holdBefore, RaceGate } from '../utils/race-gate';
import crypto from 'crypto';
import { MailService } from '../../src/mail/mail.service';
import { MailDispatcherService } from '../../src/mail/mail-dispatcher.service';
import { SEED_USER } from '../constants/seed-users';
import { browserAgent, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import {
  bootBrowserCodeApp,
  CODE_REQUEST,
  nonceOf,
  postCode,
  rawVerifyCode,
  storedCode,
  verifyCode,
} from './browser-code.fixtures';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('browser code delivery and late completion', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootBrowserCodeApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });
  afterEach(() => jest.restoreAllMocks());

  it('cannot authenticate while transport is pending and activates only after successful delivery', async () => {
    const entropy: { randomInt(min: number, max: number): number } = crypto;
    jest.spyOn(entropy, 'randomInt').mockReturnValueOnce(123456);
    const gate = deferred();
    const mail = e2e.app.get(MailService);
    const send = mail.sendMail.bind(mail);
    jest.spyOn(mail, 'sendMail').mockImplementationOnce(async (message) => {
      await gate.promise;
      await send(message);
    });
    const browser = await browserAgent(e2e.httpServer);
    const answer = await postCode(browser, CODE_REQUEST, {
      body: { email: SEED_USER.email },
    });
    try {
      expect(answer.status).toBe(200);
      expect(await storedCode(e2e, nonceOf(answer))).toMatchObject({
        codeHash: expect.stringMatching(/^pending:/u),
        spentAt: TEST_NOW,
      });
      expect((await verifyCode(browser, '123456')).status).toBe(400);
      expect(await e2e.state.sessions.countSessions()).toBe(0);
    } finally {
      gate.resolve();
      await e2e.app.get(MailDispatcherService).flush();
    }
    expect((await verifyCode(browser, '123456')).status).toBe(200);
    expect(await e2e.state.sessions.countSessions()).toBe(1);
  });

  it('does not reactivate a cancelled ceremony when its first delivery finishes after a resend', async () => {
    const entropy: { randomInt(min: number, max: number): number } = crypto;
    jest
      .spyOn(entropy, 'randomInt')
      .mockReturnValueOnce(123456)
      .mockReturnValueOnce(234567);
    const gate = deferred();
    const mail = e2e.app.get(MailService);
    const send = mail.sendMail.bind(mail);
    jest.spyOn(mail, 'sendMail').mockImplementationOnce(async (message) => {
      await gate.promise;
      await send(message);
    });
    const browser = await browserAgent(e2e.httpServer);
    const first = await postCode(browser, CODE_REQUEST, {
      body: { email: SEED_USER.email },
    });
    let secondNonce = '';
    try {
      const second = await postCode(browser, CODE_REQUEST, {
        body: { email: SEED_USER.email },
      });
      expect(second.status).toBe(200);
      secondNonce = nonceOf(second);
      expect((await storedCode(e2e, nonceOf(first)))?.codeHash).toBe('');
    } finally {
      gate.resolve();
      await e2e.app.get(MailDispatcherService).flush();
    }
    expect(
      (await rawVerifyCode(e2e, { nonce: nonceOf(first), code: '123456' }))
        .status,
    ).toBe(400);
    expect((await storedCode(e2e, nonceOf(first)))?.spentAt).toEqual(TEST_NOW);
    expect(
      (await rawVerifyCode(e2e, { nonce: secondNonce, code: '234567' })).status,
    ).toBe(200);
    expect(await e2e.state.sessions.countSessions()).toBe(1);
  });
  it('cancels the current old generation when activation races the transactional resend read', async () => {
    const entropy: { randomInt(min: number, max: number): number } = crypto;
    jest
      .spyOn(entropy, 'randomInt')
      .mockReturnValueOnce(123456)
      .mockReturnValueOnce(234567);
    const transport = deferred();
    const mail = e2e.app.get(MailService);
    const send = mail.sendMail.bind(mail);
    jest.spyOn(mail, 'sendMail').mockImplementationOnce(async (message) => {
      await transport.promise;
      await send(message);
    });
    const browser = await browserAgent(e2e.httpServer);
    const first = await postCode(browser, CODE_REQUEST, {
      body: { email: SEED_USER.email },
    });
    const codes = e2e.app.get(EmailCodeStore);
    const cancellation = new RaceGate();
    const delivery = new RaceGate();
    const restoreCancel = holdBefore(codes, 'cancelIn', () => cancellation);
    const restoreDeliver = holdBefore(codes, 'deliverIn', (call) =>
      call === 0 ? delivery : undefined,
    );
    const resending = postCode(browser, CODE_REQUEST, {
      body: { email: SEED_USER.email },
    });
    try {
      await cancellation.reached();
      transport.resolve();
      await delivery.reached();
    } finally {
      delivery.release();
      cancellation.release();
      restoreCancel();
      restoreDeliver();
    }
    const second = await resending;
    await e2e.app.get(MailDispatcherService).flush();
    expect(second.status).toBe(200);
    expect((await storedCode(e2e, nonceOf(first)))?.codeHash).toBe('');
    expect(
      (await rawVerifyCode(e2e, { nonce: nonceOf(first), code: '123456' }))
        .status,
    ).toBe(400);
    expect(
      (await rawVerifyCode(e2e, { nonce: nonceOf(second), code: '234567' }))
        .status,
    ).toBe(200);
    expect(await e2e.state.sessions.countSessions()).toBe(1);
  });
});
