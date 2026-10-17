import { ErrorCode } from '@app/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_ID } from '../../src/constants';
import { LAPTOP, PHONE, TABLET } from '../support/devices';
import { signedInAs } from '../support/fake-engine';
import { noResponse, refusal, ROUTE, sessionList } from '../support/fake-server';
import { LOCALES } from '../support/locales';
import { device } from '../support/react-native';
import {
  accessibilityOf,
  byTestId,
  cleanup,
  isShown,
  press,
  pullToRefresh,
  renderApp,
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
  it('asks before signing another device out, naming it, and sends nothing when declined', async () => {
    const app = await listed(locale);

    await press(app.root, REVOKE('laptop'));
    expect(app.confirm.asked).toEqual([
      {
        title: app.t('sessions.confirmRevoke.title', { device: '\u2068Work laptop\u2069' }),
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
        title: app.t('sessions.confirmRevoke.title', { device: '\u2068Pocket phone\u2069' }),
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
          app.t('sessions.revokeFailed.title', { device: '\u2068Work laptop\u2069' }),
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
      expect(accessibilityOf(byTestId(app.root, TEST_ID.SESSIONS_REFRESH))).toEqual({
        accessibilityRole: 'button',
        accessibilityLabel: app.t('sessions.refresh'),
        accessibilityHint: undefined,
        accessibilityState: IDLE,
      });

      await press(app.root, TEST_ID.SESSIONS_REFRESH);
      await app.step(() => app.server.answer(ROUTE.SESSIONS, sessionList([PHONE, LAPTOP])));
      expect({ alerts: alerts(app), rows: rows(app) }).toEqual({
        alerts: [],
        rows: ['phone', 'laptop'],
      });
    },
  );

  it('keeps the refresh button available across list states and blocks overlapping reads', async () => {
    const app = await opened(locale);
    await app.step(() =>
      app.server.answer(ROUTE.SESSIONS, refusal(503, ErrorCode.AUTHORITY_UNAVAILABLE)),
    );
    expect(
      accessibilityOf(byTestId(app.root, TEST_ID.SESSIONS_REFRESH)).accessibilityState,
    ).toEqual(IDLE);

    const sentBeforeRefresh = app.server.sent().filter((route) => route === ROUTE.SESSIONS).length;
    await press(app.root, TEST_ID.SESSIONS_REFRESH);
    expect(
      accessibilityOf(byTestId(app.root, TEST_ID.SESSIONS_REFRESH)).accessibilityState,
    ).toEqual({
      disabled: true,
      busy: true,
    });

    await press(app.root, TEST_ID.SESSIONS_REFRESH);
    await pullToRefresh(app.root);
    expect(app.server.sent().filter((route) => route === ROUTE.SESSIONS).length).toBe(
      sentBeforeRefresh + 1,
    );

    await app.step(() => app.server.answer(ROUTE.SESSIONS, sessionList([PHONE])));
    expect(isShown(app.root, TEST_ID.SESSIONS_REFRESH)).toBe(true);
    expect(isShown(app.root, TEST_ID.SESSIONS_NOTICE)).toBe(false);
  });

  it('focuses the destination screen title after each signed-in route change', async () => {
    const app = await renderApp(signedInAs('ada'));
    const focusedTitles = () =>
      device.accessibilityFocusTags.map((tag) => {
        const nativeNode = device.nativeNodes[tag - 1];
        if (typeof nativeNode !== 'object' || nativeNode === null)
          throw new Error('The native title ref did not resolve.');
        const node = nativeNode as {
          props: { accessibilityRole?: string; accessible?: boolean; children?: string };
        };
        return {
          role: node.props.accessibilityRole,
          accessible: node.props.accessible,
          title: node.props.children,
        };
      });

    expect(focusedTitles()).toEqual([
      {
        role: 'header',
        accessible: true,
        title: app.t('account.title'),
      },
    ]);

    await press(app.root, TEST_ID.ACCOUNT_SESSIONS_LINK);
    await press(app.root, TEST_ID.SESSIONS_BACK);
    expect(focusedTitles()).toEqual([
      { role: 'header', accessible: true, title: app.t('account.title') },
      { role: 'header', accessible: true, title: app.t('sessions.title') },
      { role: 'header', accessible: true, title: app.t('account.title') },
    ]);
  });
});
