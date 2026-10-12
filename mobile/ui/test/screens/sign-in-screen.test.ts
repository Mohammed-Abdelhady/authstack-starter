import type { RestoreOutcome, SignInOutcome } from '@app/native-auth';
import { OAuthError, TransportError } from '@app/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_ID } from '../../src/constants';
import type { MessageKey } from '../../src/i18n';
import { deferred, signedInAs, SIGNED_OUT } from '../support/fake-engine';
import { LOCALES } from '../support/locales';
import { device } from '../support/react-native';
import {
  accessibilityOf,
  APP_NAME,
  byTestId,
  cleanup,
  isShown,
  press,
  renderApp,
  textsOf,
  unmountAll,
  type App,
} from '../support/render';

vi.mock('react-native', () => import('../support/react-native'));

afterEach(cleanup);

const ADA = signedInAs('ada');

const action = (app: App) => byTestId(app.root, TEST_ID.SIGN_IN_ACTION);
const notice = (app: App) => byTestId(app.root, TEST_ID.SIGN_IN_NOTICE);

/** What the person can do with the button and what the notice under it says. */
function shown(app: App) {
  return {
    button: accessibilityOf(action(app)),
    disabled: action(app).props.disabled,
    notice: isShown(app.root, TEST_ID.SIGN_IN_NOTICE)
      ? { role: notice(app).props.accessibilityRole, text: textsOf(notice(app)) }
      : undefined,
  };
}

const button = (app: App, label: MessageKey, busy: boolean) => ({
  accessibilityRole: 'button',
  accessibilityLabel: app.t(label),
  accessibilityHint: app.t('signIn.actionHint'),
  accessibilityState: { disabled: busy, busy },
});

describe.each(LOCALES)('the sign-in screen in %s', (locale) => {
  it('names the product and offers one enabled button once storage has been read', async () => {
    const app = await renderApp(SIGNED_OUT, { locale });

    expect(textsOf(byTestId(app.root, TEST_ID.SIGN_IN_SCREEN)).slice(0, 2)).toEqual([
      app.t('signIn.title', { appName: APP_NAME }),
      app.t('signIn.description'),
    ]);
    expect(shown(app)).toEqual({
      button: button(app, 'signIn.action', false),
      disabled: false,
      notice: undefined,
    });
  });

  it('holds the button busy and says so while the saved sign-in is being read', async () => {
    const restore = deferred<RestoreOutcome>();
    const app = await renderApp(SIGNED_OUT, {
      locale,
      prepare: (fake) => {
        fake.engine.restore = () => restore.promise;
      },
    });

    expect(shown(app)).toEqual({
      button: button(app, 'signIn.restoring', true),
      disabled: true,
      notice: undefined,
    });

    await press(app.root, TEST_ID.SIGN_IN_ACTION);
    expect(app.fake.signIns).toHaveLength(0);

    await app.step(() => restore.resolve({ kind: 'restored', status: 'signedOut' }));
    expect(shown(app).button).toEqual(button(app, 'signIn.action', false));
  });

  it('starts one sign-in on a tap and ignores taps until the browser comes back', async () => {
    const app = await renderApp(SIGNED_OUT, { locale });

    await press(app.root, TEST_ID.SIGN_IN_ACTION);
    await press(app.root, TEST_ID.SIGN_IN_ACTION);

    expect({ signIns: app.fake.signIns.length, restores: app.fake.restores }).toEqual({
      signIns: 1,
      restores: 1,
    });
    expect(shown(app)).toEqual({
      button: button(app, 'signIn.waiting', true),
      disabled: true,
      notice: {
        role: 'summary',
        text: [app.t('signIn.inProgress.title'), app.t('signIn.inProgress.description')],
      },
    });
  });

  it.each([
    [
      'the browser is closed',
      { kind: 'cancelled' },
      'summary',
      'signIn.browserClosed.title',
      'signIn.browserClosed.description',
      'signIn.action',
    ],
    [
      'the server cannot be reached',
      { kind: 'transportFailure', error: new TransportError() },
      'alert',
      'signIn.offline.title',
      'common.offline',
      'common.tryAgain',
    ],
    [
      'the server refuses the sign-in',
      { kind: 'authorizationDenied', error: 'access_denied' },
      'alert',
      'signIn.failed.title',
      'signIn.failed.denied',
      'common.tryAgain',
    ],
    [
      'sign-in from the app is turned off',
      { kind: 'disabled' },
      'alert',
      'signIn.failed.title',
      'signIn.failed.disabled',
      'common.tryAgain',
    ],
    [
      'the account holds its limit of signed-in devices',
      { kind: 'oauthFailure', error: new OAuthError({ status: 400, error: 'access_denied' }) },
      'alert',
      'signIn.failed.title',
      'signIn.failed.sessionLimit',
      'common.tryAgain',
    ],
    [
      'the token request is refused for another reason',
      { kind: 'oauthFailure', error: new OAuthError({ status: 400, error: 'invalid_grant' }) },
      'alert',
      'signIn.failed.title',
      'signIn.failed.generic',
      'common.tryAgain',
    ],
  ] as const satisfies readonly (readonly [string, SignInOutcome, ...string[]])[])(
    'says what happened when %s and lets the person try again',
    async (_name, outcome, role, title, description, label) => {
      const app = await renderApp(SIGNED_OUT, { locale });
      await press(app.root, TEST_ID.SIGN_IN_ACTION);

      await app.step(() => app.fake.signIns[0]?.resolve(outcome));

      expect(shown(app)).toEqual({
        button: button(app, label, false),
        disabled: false,
        notice: { role, text: [app.t(title), app.t(description)] },
      });
      await press(app.root, TEST_ID.SIGN_IN_ACTION);
      expect(app.fake.signIns).toHaveLength(2);
    },
  );
  it('says sign-in from the app is switched off when the service ended the session that way', async () => {
    const app = await renderApp(ADA, { locale });

    await app.publish({ status: 'signedOut', operation: 'none', reason: 'disabled' });

    expect(shown(app)).toEqual({
      button: button(app, 'signIn.action', false),
      disabled: false,
      notice: {
        role: 'alert',
        text: [app.t('signIn.switchedOff.title'), app.t('signIn.switchedOff.description')],
      },
    });
    await press(app.root, TEST_ID.SIGN_IN_ACTION);
    expect(app.fake.signIns).toHaveLength(1);
  });
});

describe('the sign-in screen', () => {
  it('reports a problem and stays usable when the engine call itself throws', async () => {
    const app = await renderApp(SIGNED_OUT);
    await press(app.root, TEST_ID.SIGN_IN_ACTION);

    await app.step(() => app.fake.signIns[0]?.reject(new Error('port crashed')));

    expect(shown(app)).toEqual({
      button: button(app, 'common.tryAgain', false),
      disabled: false,
      notice: {
        role: 'alert',
        text: [app.t('signIn.failed.title'), app.t('signIn.failed.generic')],
      },
    });
  });

  it('gives way to the account screen when the sign-in succeeds', async () => {
    const app = await renderApp(SIGNED_OUT);
    await press(app.root, TEST_ID.SIGN_IN_ACTION);

    await app.step(() => {
      app.fake.publish(ADA);
      app.fake.signIns[0]?.resolve({ kind: 'alreadySignedIn' });
    });

    expect({
      signIn: isShown(app.root, TEST_ID.SIGN_IN_SCREEN),
      account: isShown(app.root, TEST_ID.ACCOUNT_SCREEN),
    }).toEqual({ signIn: false, account: true });
  });

  it('reads storage again, and opens no browser, when storage is locked', async () => {
    const app = await renderApp({ status: 'storageBlocked', operation: 'none' });
    expect(shown(app)).toEqual({
      button: button(app, 'common.tryAgain', false),
      disabled: false,
      notice: {
        role: 'alert',
        text: [app.t('signIn.storageLocked.title'), app.t('signIn.storageLocked.description')],
      },
    });

    await press(app.root, TEST_ID.SIGN_IN_ACTION);

    expect({ restores: app.fake.restores, signIns: app.fake.signIns.length }).toEqual({
      restores: 2,
      signIns: 0,
    });
  });

  it('says the session ended when the engine needs a new sign-in', async () => {
    const app = await renderApp({ status: 'reauthRequired', operation: 'none' });

    expect(shown(app).notice).toEqual({
      role: 'summary',
      text: [app.t('signIn.reauth.title'), app.t('signIn.reauth.description')],
    });
  });

  it('reads storage again each time the app returns to the foreground, and not when it leaves', async () => {
    const app = await renderApp(SIGNED_OUT);

    await app.step(() => device.appStateChanged('background'));
    expect(app.fake.restores).toBe(1);

    await app.step(() => device.appStateChanged('active'));
    expect(app.fake.restores).toBe(2);
  });

  it('stops listening to the system when it is taken off the screen', async () => {
    await renderApp(SIGNED_OUT);
    expect(device.listenerCount()).toBe(2);

    unmountAll();

    expect(device.listenerCount()).toBe(0);
  });
});
