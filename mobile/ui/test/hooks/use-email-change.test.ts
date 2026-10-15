import { API_PATHS, HTTP_METHOD } from '@app/sdk';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEmailChange } from '../../src/hooks/use-email-change';
import { signedInAs, SIGNED_OUT } from '../support/fake-engine';
import { ok } from '../support/fake-server';
import { renderUiHook, type UiHookSubject } from '../support/hook';
import { cleanup, flush } from '../support/render';

vi.mock('react-native', () => import('../support/react-native'));

afterEach(cleanup);

const READ = `${HTTP_METHOD.GET} ${API_PATHS.account.email}`;
const ASK = `${HTTP_METHOD.POST} ${API_PATHS.account.email}`;

type EmailChange = ReturnType<typeof useEmailChange>;

async function editing(): Promise<UiHookSubject<EmailChange>> {
  const subject = await renderUiHook(useEmailChange, signedInAs('ada'));
  subject.server.answer(READ, ok({ email: 'ada@example.test' }));
  await flush();
  act(() => subject.current().start());
  act(() => subject.current().setAddress('new@example.test'));
  return subject;
}

describe('the email change hook', () => {
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
    subject.server.answer(ASK, ok({ email: 'ada@example.test', pendingEmail: 'new@example.test' }));
    await flush();

    expect({
      pending: subject.current().pending,
      notice: subject.current().notice,
    }).toEqual({ pending: undefined, notice: undefined });
  });
});
