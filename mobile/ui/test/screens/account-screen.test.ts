import { ErrorCode } from '@app/core';
import type { SignOutOutcome } from '@app/native-auth';
import type { User } from '@app/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_ID } from '../../src/constants';
import { signedInAs } from '../support/fake-engine';
import { noResponse, ok, refusal, ROUTE } from '../support/fake-server';
import { LOCALES } from '../support/locales';
import { device } from '../support/react-native';
import {
  accessibilityOf,
  byRole,
  byTestId,
  cleanup,
  isShown,
  press,
  renderApp,
  textsOf,
  type App,
} from '../support/render';

vi.mock('react-native', () => import('../support/react-native'));

afterEach(cleanup);

const ADA = signedInAs('ada');
const PROFILE: User = { ...ADA.profile, name: 'Ada Lovelace', email: 'ada@example.test' } as User;
const REVOKED: SignOutOutcome = { kind: 'signedOut', revocation: 'revoked' };

const screenText = (app: App) => textsOf(byTestId(app.root, TEST_ID.ACCOUNT_SCREEN));
const alerts = (app: App) => byRole(app.root, 'alert').map(textsOf);
const loading = (app: App) =>
  byRole(app.root, 'progressbar').map((node) => ({
    label: node.props.accessibilityLabel,
    state: node.props.accessibilityState,
  }));

describe.each(LOCALES)('the account screen in %s', (locale) => {
  it('asks the server for the profile and reads as loading until it answers', async () => {
    const app = await renderApp(ADA, { locale });

    expect(app.server.sent()).toEqual([ROUTE.PROFILE]);
    expect(loading(app)).toEqual([{ label: app.t('account.loading'), state: { busy: true } }]);
    expect(screenText(app)).not.toContain(app.t('account.name'));
  });

  it('shows the name, email and role the server holds', async () => {
    const app = await renderApp(ADA, { locale });

    await app.step(() => app.server.answer(ROUTE.PROFILE, ok(PROFILE)));

    expect(loading(app)).toEqual([]);
    expect(screenText(app)).toEqual(
      expect.arrayContaining([
        app.t('account.name'),
        '\u2068Ada Lovelace\u2069',
        app.t('account.email'),
        '\u2066ada@example.test\u2069',
        app.t('account.role'),
        app.t('role.user'),
      ]),
    );
  });

  it.each([
    [
      'the server refuses',
      (app: App) => app.server.answer(ROUTE.PROFILE, refusal(503, ErrorCode.AUTHORITY_UNAVAILABLE)),
      'common.serverError',
    ],
    [
      'the server cannot be reached',
      (app: App) => app.server.fail(ROUTE.PROFILE, noResponse()),
      'common.offline',
    ],
  ] as const)(
    'says the account could not be loaded when %s, and reads it again on a retry',
    async (_name, fail, description) => {
      const app = await renderApp(ADA, { locale });

      await app.step(() => fail(app));

      expect(alerts(app)).toEqual([[app.t('account.error.title'), app.t(description)]]);
      expect(byRole(app.root, 'alert')[0]?.props.accessibilityLiveRegion).toBe('polite');
      expect(device.accessibilityAnnouncements).toEqual([]);
      expect(accessibilityOf(byTestId(app.root, TEST_ID.ACCOUNT_RETRY))).toEqual({
        accessibilityRole: 'button',
        accessibilityLabel: app.t('common.tryAgain'),
        accessibilityHint: undefined,
        accessibilityState: { disabled: false, busy: false },
      });

      await press(app.root, TEST_ID.ACCOUNT_RETRY);
      expect(app.server.sent()).toEqual([ROUTE.PROFILE, ROUTE.PROFILE]);

      await app.step(() => app.server.answer(ROUTE.PROFILE, ok(PROFILE)));
      expect(alerts(app)).toEqual([]);
      expect(isShown(app.root, TEST_ID.ACCOUNT_RETRY)).toBe(false);
      expect(screenText(app)).toContain('\u2068Ada Lovelace\u2069');
    },
  );

  it('announces a newly mounted notice once on iOS', async () => {
    device.platform = 'ios';
    const app = await renderApp(ADA, { strictMode: true });

    await app.step(() => app.server.fail(ROUTE.PROFILE, noResponse()));
    const expected = `${app.t('account.error.title')}. ${app.t('common.offline')}`;
    expect(device.accessibilityAnnouncements).toEqual([expected]);

    await app.publish(signedInAs('ada'));
    expect(device.accessibilityAnnouncements).toEqual([expected]);
  });

  it('tells a screen reader what the two actions do', async () => {
    const app = await renderApp(ADA, { locale });

    expect([
      accessibilityOf(byTestId(app.root, TEST_ID.ACCOUNT_SESSIONS_LINK)),
      accessibilityOf(byTestId(app.root, TEST_ID.ACCOUNT_SIGN_OUT)),
    ]).toEqual([
      {
        accessibilityRole: 'button',
        accessibilityLabel: app.t('account.sessions.action'),
        accessibilityHint: undefined,
        accessibilityState: { disabled: false, busy: false },
      },
      {
        accessibilityRole: 'button',
        accessibilityLabel: app.t('account.signOut'),
        accessibilityHint: app.t('account.signOutHint'),
        accessibilityState: { disabled: false, busy: false },
      },
    ]);
  });

  it('says the person is still signed in when the sign-out fails, and signs out on a retry', async () => {
    const app = await renderApp(ADA, { locale });
    app.fake.failSignOut(new Error('port crashed'));

    await press(app.root, TEST_ID.ACCOUNT_SIGN_OUT);

    expect(isShown(app.root, TEST_ID.ACCOUNT_SCREEN)).toBe(true);
    expect(alerts(app)).toEqual([
      [app.t('account.signOutFailed.title'), app.t('account.signOutFailed.description')],
    ]);
    expect(accessibilityOf(byTestId(app.root, TEST_ID.ACCOUNT_SIGN_OUT_RETRY))).toEqual({
      accessibilityRole: 'button',
      accessibilityLabel: app.t('common.tryAgain'),
      accessibilityHint: app.t('account.signOutHint'),
      accessibilityState: { disabled: false, busy: false },
    });

    const signOut = app.fake.holdSignOut();
    await press(app.root, TEST_ID.ACCOUNT_SIGN_OUT_RETRY);
    expect({ signOuts: app.fake.signOuts, alerts: alerts(app) }).toEqual({
      signOuts: 2,
      alerts: [],
    });

    await app.step(() => signOut.resolve(REVOKED));
    expect(isShown(app.root, TEST_ID.SIGN_IN_SCREEN)).toBe(true);
  });

  it('warns that the sign-in is not saved when the engine says storage refused it', async () => {
    const app = await renderApp({ ...ADA, warning: 'storageBlocked' }, { locale });

    expect(byRole(app.root, 'summary').map(textsOf)).toEqual([
      [app.t('account.storageWarning.title'), app.t('account.storageWarning.description')],
    ]);
  });
});

describe('the account screen', () => {
  it('shows no storage warning for a saved sign-in', async () => {
    const app = await renderApp(ADA);

    expect(byRole(app.root, 'summary')).toEqual([]);
  });

  it('opens the devices screen from its link and comes back on the back button', async () => {
    const app = await renderApp(ADA);

    await press(app.root, TEST_ID.ACCOUNT_SESSIONS_LINK);
    expect({
      account: isShown(app.root, TEST_ID.ACCOUNT_SCREEN),
      sessions: isShown(app.root, TEST_ID.SESSIONS_SCREEN),
      sent: app.server.sent(),
    }).toEqual({ account: false, sessions: true, sent: [ROUTE.PROFILE, ROUTE.SESSIONS] });

    await press(app.root, TEST_ID.SESSIONS_BACK);
    expect({
      account: isShown(app.root, TEST_ID.ACCOUNT_SCREEN),
      sessions: isShown(app.root, TEST_ID.SESSIONS_SCREEN),
    }).toEqual({ account: true, sessions: false });
  });

  it('steps back with the system back button, and leaves it to the system on the first screen', async () => {
    const app = await renderApp(ADA);
    expect(device.pressBack()).toBe(false);

    await press(app.root, TEST_ID.ACCOUNT_SESSIONS_LINK);
    let handled = false;
    await app.step(() => {
      handled = device.pressBack();
    });

    expect({ handled, account: isShown(app.root, TEST_ID.ACCOUNT_SCREEN) }).toEqual({
      handled: true,
      account: true,
    });
    expect(device.pressBack()).toBe(false);
  });

  it('signs out through the engine once and shows the sign-in screen when the engine has', async () => {
    const app = await renderApp(ADA);
    const signOut = app.fake.holdSignOut();

    await press(app.root, TEST_ID.ACCOUNT_SIGN_OUT);
    expect({
      signOuts: app.fake.signOuts,
      account: isShown(app.root, TEST_ID.ACCOUNT_SCREEN),
    }).toEqual({
      signOuts: 1,
      account: true,
    });

    await app.step(() => signOut.resolve(REVOKED));
    expect({
      account: isShown(app.root, TEST_ID.ACCOUNT_SCREEN),
      signIn: isShown(app.root, TEST_ID.SIGN_IN_SCREEN),
    }).toEqual({ account: false, signIn: true });
  });

  it('holds the sign-out button busy while the engine signs out', async () => {
    const app = await renderApp(ADA);
    app.fake.holdSignOut();

    await press(app.root, TEST_ID.ACCOUNT_SIGN_OUT);
    await press(app.root, TEST_ID.ACCOUNT_SIGN_OUT);

    const button = byTestId(app.root, TEST_ID.ACCOUNT_SIGN_OUT);
    expect({
      state: button.props.accessibilityState,
      disabled: button.props.disabled,
      signOuts: app.fake.signOuts,
    }).toEqual({ state: { disabled: true, busy: true }, disabled: true, signOuts: 1 });
  });

  it("does not show one person's profile to the next", async () => {
    const app = await renderApp(ADA);
    await app.step(() => app.server.answer(ROUTE.PROFILE, ok(PROFILE)));

    await app.publish({ status: 'signedOut', operation: 'none' });
    await app.publish(signedInAs('ben'));

    expect(screenText(app)).not.toContain('Ada Lovelace');
    expect(app.server.sent()).toEqual([ROUTE.PROFILE, ROUTE.PROFILE]);
  });

  it("drops one person's profile at once when the engine swaps the account without a sign-out", async () => {
    const app = await renderApp(ADA);
    await app.step(() => app.server.answer(ROUTE.PROFILE, ok(PROFILE)));

    await app.publish(signedInAs('ben'));

    expect(screenText(app)).not.toContain('Ada Lovelace');
    expect(app.server.sent()).toEqual([ROUTE.PROFILE, ROUTE.PROFILE]);
  });
});
