import { ErrorCode } from '@app/core';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSessions } from '../../src/hooks/use-sessions';
import { translate } from '../../src/i18n';
import type { SessionRow } from '../../src/types';
import { LAPTOP, PHONE, TABLET } from '../support/devices';
import { signedInAs, SIGNED_OUT } from '../support/fake-engine';
import { noResponse, ok, refusal, ROUTE, session, sessionList } from '../support/fake-server';
import { renderUiHook, type UiHookSubject } from '../support/hook';
import { cleanup, flush } from '../support/render';

vi.mock('react-native', () => import('../support/react-native'));

afterEach(cleanup);

type Sessions = ReturnType<typeof useSessions>;

async function loaded(): Promise<UiHookSubject<Sessions>> {
  const subject = await renderUiHook(useSessions, signedInAs('ada'));
  subject.server.answer(ROUTE.SESSIONS, sessionList([PHONE, LAPTOP, TABLET]));
  await flush();
  return subject;
}

function row(subject: UiHookSubject<Sessions>, id: string): SessionRow {
  const { current, others } = subject.current();
  const found = [current, ...others].find((entry) => entry?.id === id);
  if (found === undefined) throw new Error(`No row for ${id}`);
  return found;
}

/** Taps sign-out on a row and answers the question it asks. */
async function revoke(subject: UiHookSubject<Sessions>, id: string, confirmed = true) {
  act(() => subject.current().revoke(row(subject, id)));
  await flush();
  await subject.confirm.answer(confirmed);
}

const LAPTOP_STILL_IN = {
  title: translate('en', 'sessions.revokeFailed.title', { device: 'Work laptop' }),
  description: translate('en', 'sessions.revokeFailed.description'),
};

describe('the devices hook', () => {
  it('reads the list on mount and reports loading until it arrives', async () => {
    const subject = await renderUiHook(useSessions, signedInAs('ada'));

    expect({ sent: subject.server.sent(), view: subject.current().view }).toEqual({
      sent: [ROUTE.SESSIONS],
      view: 'loading',
    });
  });

  it('sets this device apart and lists the others most recently used first', async () => {
    const subject = await renderUiHook(useSessions, signedInAs('ada'));
    const older = session('older', { lastUsedAt: '2026-06-09T08:00:00.000Z' });
    const newer = session('newer', { lastUsedAt: '2026-06-10T07:00:00.000Z' });

    subject.server.answer(ROUTE.SESSIONS, sessionList([older, PHONE, newer]));
    await flush();

    const { view, current, others, refreshing, problem } = subject.current();
    expect({
      view,
      current: current?.id,
      others: others.map((entry) => entry.id),
      refreshing,
      problem,
    }).toEqual({
      view: 'ready',
      current: 'phone',
      others: ['newer', 'older'],
      refreshing: false,
      problem: undefined,
    });
  });

  it.each([
    ['the server refuses', refusal(503, ErrorCode.AUTHORITY_UNAVAILABLE), 'common.serverError'],
    ['the server cannot be reached', undefined, 'common.offline'],
  ] as const)('reports an error and why when %s on the first read', async (_name, answer, text) => {
    const subject = await renderUiHook(useSessions, signedInAs('ada'));

    if (answer === undefined) subject.server.fail(ROUTE.SESSIONS, noResponse());
    else subject.server.answer(ROUTE.SESSIONS, answer);
    await flush();

    expect({ view: subject.current().view, failureText: subject.current().failureText }).toEqual({
      view: 'error',
      failureText: translate('en', text),
    });
  });

  it('reports a pull as refreshing only until the list is answered', async () => {
    const subject = await loaded();

    act(() => subject.current().refresh());
    await flush();
    expect({ refreshing: subject.current().refreshing, sent: subject.server.sent() }).toEqual({
      refreshing: true,
      sent: [ROUTE.SESSIONS, ROUTE.SESSIONS],
    });

    subject.server.answer(ROUTE.SESSIONS, sessionList([PHONE]));
    await flush();
    expect({ refreshing: subject.current().refreshing, view: subject.current().view }).toEqual({
      refreshing: false,
      view: 'empty',
    });
  });

  it('stops refreshing when the pull fails', async () => {
    const subject = await loaded();

    act(() => subject.current().refresh());
    await flush();
    subject.server.fail(ROUTE.SESSIONS, noResponse());
    await flush();

    expect(subject.current().refreshing).toBe(false);
  });

  it('names the device in the problem after a refused sign-out, and a pull clears it', async () => {
    const subject = await loaded();

    await revoke(subject, 'laptop');
    subject.server.answer(ROUTE.revoke('laptop'), refusal(503, ErrorCode.AUTHORITY_UNAVAILABLE));
    await flush();
    expect(subject.current().problem).toEqual(LAPTOP_STILL_IN);

    act(() => subject.current().refresh());
    await flush();
    expect(subject.current().problem).toBeUndefined();
  });

  it('reports no problem when the sign-out is declined, accepted, or already done', async () => {
    const subject = await loaded();

    await revoke(subject, 'laptop', false);
    const declined = subject.current().problem;
    await revoke(subject, 'laptop');
    subject.server.answer(ROUTE.revoke('laptop'), refusal(404, ErrorCode.SESSION_NOT_FOUND));
    await flush();

    expect({ declined, ended: subject.current().problem }).toEqual({
      declined: undefined,
      ended: undefined,
    });
  });

  it('sends nothing and reports nothing for a second sign-out while the first is still out', async () => {
    const subject = await loaded();
    await revoke(subject, 'laptop');

    await revoke(subject, 'tablet');
    act(() => subject.current().revokeOthers());
    await flush();
    await subject.confirm.answer(true);

    expect({ sent: subject.server.sent().slice(1), problem: subject.current().problem }).toEqual({
      sent: [ROUTE.revoke('laptop')],
      problem: undefined,
    });
  });

  it('reports no problem to the next person when the account changes mid-request', async () => {
    const subject = await loaded();
    await revoke(subject, 'laptop');

    act(() => {
      subject.fake.publish(SIGNED_OUT);
      subject.fake.publish(signedInAs('ben'));
    });
    subject.server.answer(ROUTE.revoke('laptop'), refusal(503, ErrorCode.AUTHORITY_UNAVAILABLE));
    await flush();

    expect(subject.current().problem).toBeUndefined();
  });

  it('reports the problem for every other device when that sign-out is refused', async () => {
    const subject = await loaded();

    act(() => subject.current().revokeOthers());
    await flush();
    await subject.confirm.answer(true);
    subject.server.answer(ROUTE.REVOKE_OTHERS, ok({ revokedCount: 2 }));
    await flush();
    expect(subject.current().problem).toBeUndefined();

    act(() => subject.current().revokeOthers());
    await flush();
    await subject.confirm.answer(true);
    subject.server.answer(ROUTE.REVOKE_OTHERS, refusal(401, ErrorCode.SESSION_INVALID));
    await flush();
    expect(subject.current().problem).toEqual({
      title: translate('en', 'sessions.revokeOthersFailed.title'),
      description: translate('en', 'sessions.revokeOthersFailed.description'),
    });
  });

  it('names the row whose write is out, through a second tap elsewhere, until that write ends', async () => {
    const subject = await loaded();
    act(() => subject.current().revoke(row(subject, 'laptop')));
    await flush();
    expect(subject.current().writingRow).toBeUndefined();

    await subject.confirm.answer(true);
    expect(subject.current().writingRow).toBe('laptop');

    const tablet = row(subject, 'tablet');
    act(() => subject.current().revoke(tablet));
    await flush();
    await subject.confirm.answer(true);
    expect(subject.current().writingRow).toBe('laptop');

    subject.server.answer(ROUTE.revoke('laptop'), ok({ message: 'done' }));
    await flush();
    expect(subject.current().writingRow).toBeUndefined();
  });

  it('reports the sign-out of every other device as under way only from the yes to the answer', async () => {
    const subject = await loaded();
    act(() => subject.current().revokeOthers());
    await flush();
    await subject.confirm.answer(false);
    expect(subject.current().writingOthers).toBe(false);

    act(() => subject.current().revokeOthers());
    await flush();
    await subject.confirm.answer(true);
    expect(subject.current().writingOthers).toBe(true);

    subject.server.answer(ROUTE.REVOKE_OTHERS, refusal(401, ErrorCode.SESSION_INVALID));
    await flush();
    expect(subject.current().writingOthers).toBe(false);
  });
});
