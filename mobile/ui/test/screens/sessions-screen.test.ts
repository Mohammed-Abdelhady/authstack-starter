import { ErrorCode } from '@app/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_ID } from '../../src/constants';
import { LAPTOP, PHONE, TABLET } from '../support/devices';
import { noResponse, refusal, ROUTE, sessionList } from '../support/fake-server';
import { LOCALES } from '../support/locales';
import {
  accessibilityOf,
  byRole,
  byTestId,
  cleanup,
  isShown,
  press,
  refreshControl,
  textsOf,
  type App,
} from '../support/render';
import {
  alerts,
  IDLE,
  listed,
  opened,
  problem,
  REVOKE,
  rows,
  writes,
} from '../support/sessions-screen';

vi.mock('react-native', () => import('../support/react-native'));

afterEach(cleanup);

describe.each(LOCALES)('the devices screen in %s', (locale) => {
  it('reads as loading until the list arrives', async () => {
    const app = await opened(locale);

    expect(
      byRole(app.root, 'progressbar').map((node) => ({
        label: node.props.accessibilityLabel,
        state: node.props.accessibilityState,
      })),
    ).toEqual([{ label: app.t('sessions.loading'), state: { busy: true } }]);
    expect(rows(app)).toEqual([]);
  });

  it('names each sign-out button after the device it signs out', async () => {
    const app = await listed(locale);

    expect(rows(app)).toEqual(['phone', 'laptop', 'tablet']);
    expect(byRole(app.root, 'progressbar')).toEqual([]);
    expect([
      accessibilityOf(byTestId(app.root, REVOKE('phone'))),
      accessibilityOf(byTestId(app.root, REVOKE('laptop'))),
      accessibilityOf(byTestId(app.root, TEST_ID.SESSIONS_REVOKE_OTHERS)),
      accessibilityOf(byTestId(app.root, TEST_ID.SESSIONS_BACK)),
    ]).toEqual([
      {
        accessibilityRole: 'button',
        accessibilityLabel: app.t('account.signOut'),
        accessibilityHint: app.t('account.signOutHint'),
        accessibilityState: IDLE,
      },
      {
        accessibilityRole: 'button',
        accessibilityLabel: app.t('sessions.revokeLabel', { device: 'Work laptop' }),
        accessibilityHint: undefined,
        accessibilityState: IDLE,
      },
      {
        accessibilityRole: 'button',
        accessibilityLabel: app.t('sessions.revokeOthers'),
        accessibilityHint: undefined,
        accessibilityState: IDLE,
      },
      {
        accessibilityRole: 'button',
        accessibilityLabel: app.t('sessions.back'),
        accessibilityHint: undefined,
        accessibilityState: IDLE,
      },
    ]);
  });

  it('asks before signing another device out, naming it, and sends nothing when declined', async () => {
    const app = await listed(locale);

    await press(app.root, REVOKE('laptop'));
    expect(app.confirm.asked).toEqual([
      {
        title: app.t('sessions.confirmRevoke.title', { device: 'Work laptop' }),
        message: app.t('sessions.confirmRevoke.message'),
        confirmLabel: app.t('sessions.revoke'),
        cancelLabel: app.t('common.cancel'),
      },
    ]);
    expect(writes(app)).toEqual([]);

    await app.confirm.answer(false);
    expect({ writes: writes(app), rows: rows(app), problem: problem(app) }).toEqual({
      writes: [],
      rows: ['phone', 'laptop', 'tablet'],
      problem: undefined,
    });
  });

  it('asks before signing this device out, and stays signed in when declined', async () => {
    const app = await listed(locale);

    await press(app.root, REVOKE('phone'));
    expect(app.confirm.asked).toEqual([
      {
        title: app.t('sessions.confirmRevoke.title', { device: 'Pocket phone' }),
        message: app.t('sessions.confirmRevoke.message'),
        confirmLabel: app.t('sessions.revoke'),
        cancelLabel: app.t('common.cancel'),
      },
    ]);
    expect(app.fake.signOuts).toBe(0);

    await app.confirm.answer(false);
    expect({
      signOuts: app.fake.signOuts,
      sessions: isShown(app.root, TEST_ID.SESSIONS_SCREEN),
    }).toEqual({ signOuts: 0, sessions: true });
  });

  it.each([
    [
      'the server refuses',
      (app: App) =>
        app.server.answer(ROUTE.revoke('laptop'), refusal(503, ErrorCode.AUTHORITY_UNAVAILABLE)),
    ],
    [
      'the server cannot be reached',
      (app: App) => app.server.fail(ROUTE.revoke('laptop'), noResponse()),
    ],
  ] as const)(
    'puts the device back and says it is still signed in when %s',
    async (_name, fail) => {
      const app = await listed(locale);
      await press(app.root, REVOKE('laptop'));
      await app.confirm.answer(true);
      expect({ writes: writes(app), rows: rows(app) }).toEqual({
        writes: [ROUTE.revoke('laptop')],
        rows: ['phone', 'tablet'],
      });

      await app.step(() => fail(app));
      await app.step(() => app.server.answer(ROUTE.SESSIONS, sessionList([PHONE, LAPTOP, TABLET])));

      expect(rows(app)).toEqual(['phone', 'laptop', 'tablet']);
      expect(alerts(app)).toEqual([
        [
          app.t('sessions.revokeFailed.title', { device: 'Work laptop' }),
          app.t('sessions.revokeFailed.description'),
        ],
      ]);
    },
  );

  it('asks before signing every other device out and says so when the server refuses', async () => {
    const app = await listed(locale);

    await press(app.root, TEST_ID.SESSIONS_REVOKE_OTHERS);
    expect(app.confirm.asked).toEqual([
      {
        title: app.t('sessions.confirmOthers.title'),
        message: app.t('sessions.confirmOthers.message'),
        confirmLabel: app.t('sessions.revokeOthers'),
        cancelLabel: app.t('common.cancel'),
      },
    ]);
    await app.confirm.answer(true);
    expect({ writes: writes(app), rows: rows(app) }).toEqual({
      writes: [ROUTE.REVOKE_OTHERS],
      rows: ['phone'],
    });

    await app.step(() =>
      app.server.answer(ROUTE.REVOKE_OTHERS, refusal(401, ErrorCode.SESSION_INVALID)),
    );
    await app.step(() => app.server.answer(ROUTE.SESSIONS, sessionList([PHONE, LAPTOP, TABLET])));
    expect(rows(app)).toEqual(['phone', 'laptop', 'tablet']);
    expect(alerts(app)).toEqual([
      [
        app.t('sessions.revokeOthersFailed.title'),
        app.t('sessions.revokeOthersFailed.description'),
      ],
    ]);
  });

  it.each([
    [
      'the server refuses',
      (app: App) =>
        app.server.answer(ROUTE.SESSIONS, refusal(503, ErrorCode.AUTHORITY_UNAVAILABLE)),
      'common.serverError',
    ],
    [
      'the server cannot be reached',
      (app: App) => app.server.fail(ROUTE.SESSIONS, noResponse()),
      'common.offline',
    ],
  ] as const)(
    'says the devices could not be loaded when %s, and reads them again on a retry',
    async (_name, fail, description) => {
      const app = await opened(locale);

      await app.step(() => fail(app));
      expect(alerts(app)).toEqual([[app.t('sessions.error.title'), app.t(description)]]);
      expect(accessibilityOf(byTestId(app.root, TEST_ID.SESSIONS_RETRY))).toEqual({
        accessibilityRole: 'button',
        accessibilityLabel: app.t('common.tryAgain'),
        accessibilityHint: undefined,
        accessibilityState: IDLE,
      });

      await press(app.root, TEST_ID.SESSIONS_RETRY);
      await app.step(() => app.server.answer(ROUTE.SESSIONS, sessionList([PHONE, LAPTOP])));
      expect({ alerts: alerts(app), rows: rows(app) }).toEqual({
        alerts: [],
        rows: ['phone', 'laptop'],
      });
    },
  );

  it('says there are no other devices, and offers no sign-out for them, when only this one is listed', async () => {
    const app = await listed(locale, [PHONE]);

    expect(byRole(app.root, 'summary').map(textsOf)).toEqual([
      [app.t('sessions.empty.title'), app.t('sessions.empty.description')],
    ]);
    expect(isShown(app.root, TEST_ID.SESSIONS_REVOKE_OTHERS)).toBe(false);
  });

  it('names the pull-to-refresh control for a screen reader', async () => {
    const app = await listed(locale);

    expect(refreshControl(app.root).props.accessibilityLabel).toBe(app.t('sessions.refresh'));
  });
});
