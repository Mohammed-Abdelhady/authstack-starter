import { ErrorCode } from '@app/core';
import { describe, expect, it } from 'vitest';
import { sessionsView } from '../src/logic/session-rows';
import { revokeOtherSessions, revokeSession } from '../src/state/session-actions';
import { LAPTOP, PHONE, TABLET } from './support/devices';
import { signedInAs } from './support/fake-engine';
import { noResponse, refusal, ROUTE, sessionList, settle } from './support/fake-server';
import { createSubject, type Subject } from './support/ui';

const NOW = Date.parse('2026-06-10T08:02:00.000Z');

async function loaded(): Promise<Subject> {
  const subject = createSubject(signedInAs('ada'));
  await subject.load([PHONE, LAPTOP, TABLET]);
  return subject;
}

describe('the list read that follows a failed sign-out', () => {
  it.each([
    [
      'one device, refused',
      (subject: Subject) => revokeSession(subject.runtime, LAPTOP),
      (subject: Subject) =>
        subject.server.answer(
          ROUTE.revoke('laptop'),
          refusal(400, ErrorCode.CANNOT_REVOKE_CURRENT_SESSION),
        ),
    ],
    [
      'one device, unreachable',
      (subject: Subject) => revokeSession(subject.runtime, LAPTOP),
      (subject: Subject) => subject.server.fail(ROUTE.revoke('laptop'), noResponse()),
    ],
    [
      'every other device, session invalid',
      (subject: Subject) => revokeOtherSessions(subject.runtime),
      (subject: Subject) =>
        subject.server.answer(ROUTE.REVOKE_OTHERS, refusal(401, ErrorCode.SESSION_INVALID)),
    ],
  ] as const)(
    'is sent after %s, and the store keeps every row when it fails too',
    async (_name, write, fail) => {
      const subject = await loaded();

      const result = write(subject);
      await settle();
      fail(subject);
      expect(await result).toBe('undone');
      await settle();
      expect(subject.server.sent().filter((route) => route === ROUTE.SESSIONS)).toHaveLength(2);

      subject.server.fail(ROUTE.SESSIONS, noResponse());
      await settle();

      expect(subject.shown()).toEqual(['phone', 'laptop', 'tablet']);
    },
  );

  it('shows the list the server sends when the read succeeds', async () => {
    const subject = await loaded();
    const result = revokeSession(subject.runtime, LAPTOP);
    await settle();
    subject.server.fail(ROUTE.revoke('laptop'), noResponse());
    await result;
    await settle();

    subject.server.answer(ROUTE.SESSIONS, sessionList([PHONE, TABLET]));
    await settle();

    expect(subject.shown()).toEqual(['phone', 'tablet']);
  });
});

describe('the devices view when a read fails', () => {
  it('keeps showing the devices it has, with no error view, when a later read fails', () => {
    const view = sessionsView({
      sessions: [PHONE, LAPTOP],
      failure: { kind: 'offline' },
      now: NOW,
    });

    expect({
      view: view.view,
      current: view.current?.id,
      others: view.others.map((row) => row.id),
      failure: view.failure,
    }).toEqual({ view: 'ready', current: 'phone', others: ['laptop'], failure: undefined });
  });
});
