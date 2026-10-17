import { API_PATHS, HTTP_METHOD } from '@app/sdk';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_STEP } from '../../src/constants/email-change';
import { useEmailChange } from '../../src/hooks/use-email-change';
import {
  deferred, // feature:passkeys
  signedInAs,
  SIGNED_OUT,
} from '../support/fake-engine';
import {
  ok,
  refusal, // feature:passkeys
} from '../support/fake-server';
import { renderUiHook, type UiHookSubject } from '../support/hook';
import {
  cleanup,
  flush,
  unmountAll, // feature:passkeys
} from '../support/render';

vi.mock('react-native', () => import('../support/react-native'));

afterEach(cleanup);

const READ = `${HTTP_METHOD.GET} ${API_PATHS.account.email}`;
const ASK = `${HTTP_METHOD.POST} ${API_PATHS.account.email}`;

type EmailChange = ReturnType<typeof useEmailChange>;

/** What the section shows and holds of an account's address. */
function shown({ current, pending, step, address, code, notice }: EmailChange) {
  return { current, pending, step, address, code, notice };
}

const NOTHING_SHOWN = {
  current: undefined,
  pending: undefined,
  step: EMAIL_STEP.IDLE,
  address: '',
  code: '',
  notice: undefined,
};

async function editing(): Promise<UiHookSubject<EmailChange>> {
  const subject = await renderUiHook(useEmailChange, signedInAs('ada'));
  subject.server.answer(READ, ok({ email: 'ada@example.test' }));
  await flush();
  act(() => subject.current().start());
  act(() => subject.current().setAddress('new@example.test'));
  return subject;
}

describe('the email change hook', () => {
  // feature:passkeys:start
  it('resumes the unchanged action once after a native proof and stops on a second refusal', async () => {
    const subject = await editing();
    const proof = deferred<boolean>();
    const prove = vi.fn(() => proof.promise);
    Object.assign(subject.runtime.engine, { passkeys: { prove } });
    act(() => subject.current().send());
    await flush();
    subject.server.answer(ASK, refusal(401, 'REAUTH_REQUIRED'));
    await flush();
    expect(prove).toHaveBeenCalledTimes(1);
    expect(subject.server.sent()).toEqual([READ, ASK]);
    await act(async () => {
      proof.resolve(true);
    });
    await flush();
    expect(subject.server.sent()).toEqual([READ, ASK, ASK]);
    subject.server.answer(ASK, refusal(401, 'REAUTH_REQUIRED'));
    await flush();
    expect(prove).toHaveBeenCalledTimes(1);
    expect(subject.current().address).toBe('new@example.test');
    expect(subject.current().step).toBe(EMAIL_STEP.EDITING);
  });

  it('keeps cancellation on the same form without repeating the write', async () => {
    const subject = await editing();
    Object.assign(subject.runtime.engine, { passkeys: { prove: async () => false } });
    act(() => subject.current().send());
    await flush();
    subject.server.answer(ASK, refusal(401, 'REAUTH_REQUIRED'));
    await flush();
    expect(subject.server.sent()).toEqual([READ, ASK]);
    expect(subject.current().address).toBe('new@example.test');
    expect(subject.current().busy).toBe(false);
  });

  it('does not repeat the old account write when proof finishes after an account switch', async () => {
    const subject = await editing();
    const proof = deferred<boolean>();
    Object.assign(subject.runtime.engine, { passkeys: { prove: () => proof.promise } });
    act(() => subject.current().send());
    await flush();
    subject.server.answer(ASK, refusal(401, 'REAUTH_REQUIRED'));
    await flush();
    act(() => {
      subject.fake.publish(SIGNED_OUT);
      subject.fake.publish(signedInAs('ben'));
    });
    await act(async () => {
      proof.resolve(true);
    });
    await flush();
    expect(subject.server.sent().filter((route) => route === ASK)).toEqual([ASK]);
    expect(subject.current().address).toBe('');
  });
  it.each(['before refusal', 'during proof'])(
    'abandons the action after unmount %s',
    async (departure) => {
      const subject = await editing();
      const proof = deferred<boolean>();
      const prove = vi.fn(() => proof.promise);
      Object.assign(subject.runtime.engine, { passkeys: { prove } });
      act(() => subject.current().send());
      await flush();
      if (departure === 'before refusal') unmountAll();
      subject.server.answer(ASK, refusal(401, 'REAUTH_REQUIRED'));
      await flush();
      expect(prove).toHaveBeenCalledTimes(departure === 'before refusal' ? 0 : 1);
      if (departure === 'during proof') unmountAll();
      await act(async () => {
        proof.resolve(true);
      });
      await flush();
      expect(subject.server.sent()).toEqual([READ, ASK]);
    },
  );
  // feature:passkeys:end

  it('asks for a code once, however often send is pressed while it is on its way', async () => {
    const subject = await editing();

    act(() => {
      subject.current().send();
      subject.current().send();
    });
    await flush();

    expect(subject.server.sent()).toEqual([READ, ASK]);
  });

  it('shows the next person nothing of a change asked for by the account that left', async () => {
    const subject = await editing();
    act(() => subject.current().send());
    await flush();

    act(() => {
      subject.fake.publish(SIGNED_OUT);
      subject.fake.publish(signedInAs('ben'));
    });
    await flush();
    const beforeTheAnswer = shown(subject.current());
    subject.server.answer(ASK, ok({ email: 'ada@example.test', pendingEmail: 'new@example.test' }));
    await flush();

    expect([beforeTheAnswer, shown(subject.current())]).toEqual([NOTHING_SHOWN, NOTHING_SHOWN]);
  });
});
