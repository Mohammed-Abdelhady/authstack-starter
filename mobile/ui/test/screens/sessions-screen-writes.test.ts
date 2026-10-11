import { ErrorCode } from '@app/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_ID } from '../../src/constants';
import { PHONE, TABLET } from '../support/devices';
import { noResponse, ok, refusal, ROUTE, sessionList } from '../support/fake-server';
import { cleanup, isShown, press, pullToRefresh, refreshControl } from '../support/render';
import { alerts, listed, problem, REVOKE, rows, writes } from '../support/sessions-screen';

vi.mock('react-native', () => import('../support/react-native'));

afterEach(cleanup);

describe('signing devices out from the devices screen', () => {
  it('keeps the device out of the list once the server has ended its session', async () => {
    const app = await listed();
    await press(app.root, REVOKE('laptop'));
    await app.confirm.answer(true);

    await app.step(() => app.server.answer(ROUTE.revoke('laptop'), ok({ message: 'done' })));
    await app.step(() => app.server.answer(ROUTE.SESSIONS, sessionList([PHONE, TABLET])));

    expect({ rows: rows(app), problem: problem(app), sent: app.server.sent().slice(2) }).toEqual({
      rows: ['phone', 'tablet'],
      problem: undefined,
      sent: [ROUTE.revoke('laptop'), ROUTE.SESSIONS],
    });
  });

  it('shows a refused device again at once, and keeps it and the notice when the next read fails too', async () => {
    const app = await listed();
    await press(app.root, REVOKE('laptop'));
    await app.confirm.answer(true);
    const notice = [
      app.t('sessions.revokeFailed.title', { device: 'Work laptop' }),
      app.t('sessions.revokeFailed.description'),
    ];

    await app.step(() => app.server.fail(ROUTE.revoke('laptop'), noResponse()));
    expect({ rows: rows(app), problem: problem(app), sent: app.server.sent().slice(2) }).toEqual({
      rows: ['phone', 'laptop', 'tablet'],
      problem: notice,
      sent: [ROUTE.revoke('laptop'), ROUTE.SESSIONS],
    });

    await app.step(() => app.server.fail(ROUTE.SESSIONS, noResponse()));
    expect({ rows: rows(app), problem: problem(app) }).toEqual({
      rows: ['phone', 'laptop', 'tablet'],
      problem: notice,
    });
  });

  it('shows every other device again at once when signing them all out is refused', async () => {
    const app = await listed();
    await press(app.root, TEST_ID.SESSIONS_REVOKE_OTHERS);
    await app.confirm.answer(true);
    expect(rows(app)).toEqual(['phone']);

    await app.step(() =>
      app.server.answer(ROUTE.REVOKE_OTHERS, refusal(503, ErrorCode.AUTHORITY_UNAVAILABLE)),
    );
    expect(rows(app)).toEqual(['phone', 'laptop', 'tablet']);

    await app.step(() => app.server.fail(ROUTE.SESSIONS, noResponse()));
    expect({ rows: rows(app), problem: problem(app) }).toEqual({
      rows: ['phone', 'laptop', 'tablet'],
      problem: [
        app.t('sessions.revokeOthersFailed.title'),
        app.t('sessions.revokeOthersFailed.description'),
      ],
    });
  });

  it('sends one request when a second sign-out is confirmed while the first is still out', async () => {
    const app = await listed();
    await press(app.root, REVOKE('laptop'));
    await app.confirm.answer(true);

    await press(app.root, REVOKE('tablet'));
    await app.confirm.answer(true);
    await press(app.root, TEST_ID.SESSIONS_REVOKE_OTHERS);
    await app.confirm.answer(true);

    expect(writes(app)).toEqual([ROUTE.revoke('laptop')]);
  });

  it('clears the notice when the person acts again', async () => {
    const app = await listed();
    await press(app.root, REVOKE('laptop'));
    await app.confirm.answer(true);
    await app.step(() =>
      app.server.answer(ROUTE.revoke('laptop'), refusal(503, ErrorCode.AUTHORITY_UNAVAILABLE)),
    );
    expect(problem(app)).toBeDefined();

    await press(app.root, REVOKE('tablet'));

    expect(problem(app)).toBeUndefined();
  });

  it('signs this device out through the engine once confirmed, and sends no revoke', async () => {
    const app = await listed();
    const signOut = app.fake.holdSignOut();

    await press(app.root, REVOKE('phone'));
    await app.confirm.answer(true);
    expect({ signOuts: app.fake.signOuts, writes: writes(app) }).toEqual({
      signOuts: 1,
      writes: [],
    });

    await app.step(() => signOut.resolve({ kind: 'signedOut', revocation: 'revoked' }));
    expect(isShown(app.root, TEST_ID.SIGN_IN_SCREEN)).toBe(true);
  });

  it('says this device is still signed in when the engine could not sign it out', async () => {
    const app = await listed();
    app.fake.failSignOut(new Error('port crashed'));

    await press(app.root, REVOKE('phone'));
    await app.confirm.answer(true);

    expect({ sessions: isShown(app.root, TEST_ID.SESSIONS_SCREEN), alerts: alerts(app) }).toEqual({
      sessions: true,
      alerts: [
        [
          app.t('sessions.revokeFailed.title', { device: 'Pocket phone' }),
          app.t('sessions.revokeFailed.description'),
        ],
      ],
    });
  });

  it('shows the refresh indicator only while a pull is reading the list', async () => {
    const app = await listed();
    expect(refreshControl(app.root).props.refreshing).toBe(false);

    await pullToRefresh(app.root);
    expect({
      refreshing: refreshControl(app.root).props.refreshing,
      sent: app.server.sent(),
    }).toEqual({ refreshing: true, sent: [ROUTE.PROFILE, ROUTE.SESSIONS, ROUTE.SESSIONS] });

    await app.step(() => app.server.answer(ROUTE.SESSIONS, sessionList([PHONE, TABLET])));
    expect({ refreshing: refreshControl(app.root).props.refreshing, rows: rows(app) }).toEqual({
      refreshing: false,
      rows: ['phone', 'tablet'],
    });
  });

  it('stops the refresh indicator when a pull finds the server unreachable', async () => {
    const app = await listed();

    await pullToRefresh(app.root);
    await app.step(() => app.server.fail(ROUTE.SESSIONS, noResponse()));

    expect({ refreshing: refreshControl(app.root).props.refreshing, rows: rows(app) }).toEqual({
      refreshing: false,
      rows: ['phone', 'laptop', 'tablet'],
    });
  });
});
