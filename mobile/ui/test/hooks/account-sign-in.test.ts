import { ErrorCode } from '@app/core';
import { TransportError } from '@app/sdk';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAccount } from '../../src/hooks/use-account';
import { useSignIn } from '../../src/hooks/use-sign-in';
import { translate } from '../../src/i18n';
import { signedInAs, SIGNED_OUT } from '../support/fake-engine';
import { noResponse, ok, refusal, ROUTE } from '../support/fake-server';
import { renderUiHook } from '../support/hook';
import { LOCALES } from '../support/locales';
import { cleanup, flush } from '../support/render';

vi.mock('react-native', () => import('../support/react-native'));

afterEach(cleanup);

const ADA = signedInAs('ada');

describe('the account hook', () => {
  it('reads the profile on mount and reports loading until it arrives', async () => {
    const subject = await renderUiHook(useAccount, ADA);

    const { view, profile, sessionNotSaved } = subject.current();
    expect({ sent: subject.server.sent(), view, profile, sessionNotSaved }).toEqual({
      sent: [ROUTE.PROFILE],
      view: 'loading',
      profile: undefined,
      sessionNotSaved: false,
    });
  });

  it.each(LOCALES)(
    'hands the screen the name, email and the role in words, in %s',
    async (locale) => {
      const subject = await renderUiHook(useAccount, ADA, locale);

      subject.server.answer(ROUTE.PROFILE, ok({ ...ADA.profile, name: 'Ada', role: 'admin' }));
      await flush();

      expect({ view: subject.current().view, profile: subject.current().profile }).toEqual({
        view: 'ready',
        profile: { name: 'Ada', email: 'ada@example.test', role: translate(locale, 'role.admin') },
      });
    },
  );

  it('shows a role this build has no name for as the server spells it', async () => {
    const subject = await renderUiHook(useAccount, ADA);

    subject.server.answer(ROUTE.PROFILE, ok({ ...ADA.profile, role: 'auditor' }));
    await flush();

    expect(subject.current().profile?.role).toBe('auditor');
  });

  it.each([
    ['the session is refused', refusal(401, ErrorCode.SESSION_INVALID), 'common.serverError'],
    [
      'the app is turned off on the server',
      refusal(403, ErrorCode.NATIVE_AUTH_DISABLED),
      'common.serverError',
    ],
    ['the server cannot be reached', undefined, 'common.offline'],
  ] as const)(
    'reports an error and why when %s, and a retry reads again',
    async (_name, answer, text) => {
      const subject = await renderUiHook(useAccount, ADA);

      if (answer === undefined) subject.server.fail(ROUTE.PROFILE, noResponse());
      else subject.server.answer(ROUTE.PROFILE, answer);
      await flush();
      expect({ view: subject.current().view, failureText: subject.current().failureText }).toEqual({
        view: 'error',
        failureText: translate('en', text),
      });

      act(() => subject.current().retry());
      await flush();
      subject.server.answer(ROUTE.PROFILE, ok(ADA.profile));
      await flush();
      expect({ sent: subject.server.sent(), view: subject.current().view }).toEqual({
        sent: [ROUTE.PROFILE, ROUTE.PROFILE],
        view: 'ready',
      });
    },
  );

  it('says the sign-in is not saved when the engine warns that storage refused it', async () => {
    const subject = await renderUiHook(useAccount, { ...ADA, warning: 'storageBlocked' });

    expect(subject.current().sessionNotSaved).toBe(true);
  });

  it('signs out through the engine once per call', async () => {
    const subject = await renderUiHook(useAccount, ADA);

    act(() => subject.current().signOut());
    await flush();

    expect(subject.fake.signOuts).toBe(1);
  });

  // What the hook does today: a sign-out that fails is dropped, and the screen is told nothing.
  it('leaves the account as it was, with nothing reported, when the sign-out fails', async () => {
    const subject = await renderUiHook(useAccount, ADA);
    subject.fake.failSignOut(new Error('port crashed'));

    act(() => subject.current().signOut());
    await flush();

    expect({
      signOuts: subject.fake.signOuts,
      status: subject.fake.engine.snapshot.status,
    }).toEqual({
      signOuts: 1,
      status: 'signedIn',
    });
  });
});

describe('the sign-in hook', () => {
  it.each(LOCALES)(
    'offers the sign-in action with no notice when signed out, in %s',
    async (locale) => {
      const subject = await renderUiHook(useSignIn, SIGNED_OUT, locale);

      const { canAct, actionLabel, notice } = subject.current();
      expect({ canAct, actionLabel, notice }).toEqual({
        canAct: true,
        actionLabel: translate(locale, 'signIn.action'),
        notice: undefined,
      });
    },
  );

  it('starts a sign-in when acted on and cannot act again until it ends', async () => {
    const subject = await renderUiHook(useSignIn, SIGNED_OUT);

    act(() => subject.current().act());
    await flush();

    const { canAct, actionLabel, notice } = subject.current();
    expect({ signIns: subject.fake.signIns.length, canAct, actionLabel, notice }).toEqual({
      signIns: 1,
      canAct: false,
      actionLabel: translate('en', 'signIn.waiting'),
      notice: {
        title: translate('en', 'signIn.inProgress.title'),
        description: translate('en', 'signIn.inProgress.description'),
        problem: false,
      },
    });
  });

  it('marks an unreachable server as a problem and offers another try', async () => {
    const subject = await renderUiHook(useSignIn, SIGNED_OUT);
    act(() => subject.current().act());
    await flush();

    subject.fake.signIns[0]?.resolve({ kind: 'transportFailure', error: new TransportError() });
    await flush();

    const { canAct, actionLabel, notice } = subject.current();
    expect({ canAct, actionLabel, notice }).toEqual({
      canAct: true,
      actionLabel: translate('en', 'common.tryAgain'),
      notice: {
        title: translate('en', 'signIn.offline.title'),
        description: translate('en', 'common.offline'),
        problem: true,
      },
    });
  });

  it('reads storage again, and opens no browser, when the engine reports storage blocked', async () => {
    const subject = await renderUiHook(useSignIn, { status: 'storageBlocked', operation: 'none' });

    act(() => subject.current().act());
    await flush();

    expect({ restores: subject.fake.restores, signIns: subject.fake.signIns.length }).toEqual({
      restores: 1,
      signIns: 0,
    });
  });

  it('follows the engine: the browser being open holds the action', async () => {
    const subject = await renderUiHook(useSignIn, SIGNED_OUT);

    act(() => subject.fake.publish({ status: 'signedOut', operation: 'authorizing' }));
    await flush();

    expect(subject.current().canAct).toBe(false);
  });
});
