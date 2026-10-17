import { CredentialStoreError, type AuthSnapshot, type SignInOutcome } from '@app/native-auth';
import { ApiError, OAuthError, TransportError } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { rootView, signInView } from '../src/logic/sign-in-view';
import { createSignInController } from '../src/state/sign-in-controller';
import type { SignInAttempt } from '../src/types';
import { createFakeEngine, SIGNED_OUT } from './support/fake-engine';
import { createFakeServer, settle } from './support/fake-server';

const IDLE: SignInAttempt = { pending: false };
const ended = (outcome: SignInOutcome): SignInAttempt => ({ pending: false, outcome });
const snapshot = (
  status: AuthSnapshot['status'],
  operation: AuthSnapshot['operation'] = 'none',
): AuthSnapshot => ({ status, operation });

function controller() {
  const fake = createFakeEngine(createFakeServer().transport);
  return { fake, signIn: createSignInController(fake.engine) };
}

describe('the sign-in action', () => {
  it('opens one sign-in when it is tapped twice', () => {
    const { fake, signIn } = controller();

    signIn.run('signIn');
    signIn.run('signIn');

    expect(fake.signIns).toHaveLength(1);
    expect(signIn.getState()).toEqual({ pending: true, action: 'signIn' });
  });

  it('keeps how the attempt ended and accepts a new tap afterwards', async () => {
    const { fake, signIn } = controller();

    signIn.run('signIn');
    fake.signIns[0]?.resolve({ kind: 'cancelled' });
    await settle();

    expect(signIn.getState()).toEqual({ pending: false, outcome: { kind: 'cancelled' } });
    signIn.run('signIn');
    expect(fake.signIns).toHaveLength(2);
  });

  it('accepts a new tap after the engine call itself throws', async () => {
    const { fake, signIn } = controller();

    signIn.run('signIn');
    fake.signIns[0]?.reject(new Error('port crashed'));
    await settle();

    expect(signInView(SIGNED_OUT, signIn.getState())).toMatchObject({
      state: 'failed',
      failure: 'generic',
      canAct: true,
    });
  });

  it('reads storage again instead of opening the browser when storage was locked', async () => {
    const { fake, signIn } = controller();

    signIn.run('restore');
    await settle();

    expect({ restores: fake.restores, signIns: fake.signIns.length }).toEqual({
      restores: 1,
      signIns: 0,
    });
  });
});

describe('the sign-in screen state', () => {
  it.each([
    ['restoring', snapshot('restoring'), IDLE, 'restoring', false],
    ['signed out', SIGNED_OUT, IDLE, 'idle', true],
    ['browser open', snapshot('signedOut', 'authorizing'), IDLE, 'inProgress', false],
    ['code exchange', snapshot('signedOut', 'exchanging'), IDLE, 'inProgress', false],
    ['tap not yet seen by the engine', SIGNED_OUT, { pending: true }, 'inProgress', false],
    ['browser cancelled', SIGNED_OUT, ended({ kind: 'cancelled' }), 'browserClosed', true],
    ['browser dismissed', SIGNED_OUT, ended({ kind: 'dismissed' }), 'browserClosed', true],
    [
      'no response',
      SIGNED_OUT,
      ended({ kind: 'transportFailure', error: new TransportError() }),
      'offline',
      true,
    ],
    ['storage blocked', snapshot('storageBlocked'), IDLE, 'storageLocked', true],
  ] as const)('%s', (_name, engineSnapshot, attempt, state, canAct) => {
    const view = signInView(engineSnapshot, attempt);

    expect({ state: view.state, canAct: view.canAct }).toEqual({ state, canAct });
  });

  it.each([
    [{ kind: 'expired' }, 'expired'],
    [{ kind: 'authorizationDenied', error: 'access_denied' }, 'denied'],
    [{ kind: 'disabled' }, 'disabled'],
    [
      { kind: 'throttled', error: new ApiError({ status: 429, code: 'RATE', message: 'slow' }) },
      'throttled',
    ],
    [{ kind: 'deviceBindingRequired' }, 'deviceKey'],
    [{ kind: 'deviceKeyFailure', reason: 'keyInvalidated' }, 'deviceKey'],
    [{ kind: 'browserFailure', reason: 'no browser' }, 'browser'],
    [{ kind: 'storageFailure', error: new Error('disk') }, 'storage'],
    [
      { kind: 'storageFailure', error: new CredentialStoreError('replace', 'unavailable') },
      'storage',
    ],
    [{ kind: 'invalidCallback', reason: 'stateMismatch' }, 'generic'],
    [
      { kind: 'oauthFailure', error: new OAuthError({ status: 400, error: 'invalid_grant' }) },
      'generic',
    ],
    [
      { kind: 'oauthFailure', error: new OAuthError({ status: 400, error: 'access_denied' }) },
      'sessionLimit',
    ],
  ] as const satisfies readonly (readonly [SignInOutcome, string])[])(
    'a failed attempt says why: %o',
    (outcome, failure) => {
      const view = signInView(SIGNED_OUT, ended(outcome));

      expect({ state: view.state, failure: view.failure }).toEqual({ state: 'failed', failure });
    },
  );

  it('asks for the device to be unlocked when the locked store refused the save', () => {
    const outcome: SignInOutcome = {
      kind: 'storageFailure',
      error: new CredentialStoreError('replace', 'locked'),
    };

    const view = signInView(SIGNED_OUT, ended(outcome));

    expect({ state: view.state, action: view.action }).toEqual({
      state: 'storageLocked',
      action: 'signIn',
    });
  });

  it.each([
    ['storageFailure', 'storage'],
    ['deviceKeyUnavailable', 'deviceKey'],
  ] as const)('explains a blocked restore caused by %s', (reason, failure) => {
    expect(signInView({ status: 'storageBlocked', operation: 'none', reason }, IDLE)).toMatchObject(
      {
        state: 'failed',
        failure,
        action: 'restore',
        canAct: true,
      },
    );
  });

  it.each([
    ['locked', 'storageLocked', undefined],
    ['unavailable', 'failed', 'storage'],
    ['deviceKeyUnavailable', 'failed', 'deviceKey'],
  ] as const)(
    'passes a %s restore outcome into the screen decision',
    async (reason, state, failure) => {
      const { fake, signIn } = controller();
      fake.engine.restore = () => Promise.resolve({ kind: 'storageBlocked', reason });
      signIn.run('restore');
      expect(signInView(SIGNED_OUT, signIn.getState()).state).toBe('restoring');
      await settle();
      const view = signInView(
        { status: 'storageBlocked', operation: 'none', reason: 'storageFailure' },
        signIn.getState(),
      );
      expect({
        state: view.state,
        failure: view.failure,
        action: view.action,
        canAct: view.canAct,
      }).toEqual({
        state,
        failure,
        action: 'restore',
        canAct: true,
      });
    },
  );

  it('shows a running attempt over the way the previous one ended', () => {
    const view = signInView(snapshot('signedOut', 'authorizing'), ended({ kind: 'cancelled' }));

    expect(view.state).toBe('inProgress');
  });

  it('says sign-in is switched off only for a signed-out session the service ended that way', () => {
    const off = (status: AuthSnapshot['status'], reason?: AuthSnapshot['reason']): boolean =>
      signInView({ status, operation: 'none', ...(reason ? { reason } : {}) }, IDLE).switchedOff;

    expect([
      off('signedOut', 'disabled'),
      off('signedOut'),
      off('signedOut', 'oauthFailure'),
      off('reauthRequired', 'disabled'),
    ]).toEqual([true, false, false, false]);
  });
});

describe('which screens the root shows', () => {
  it.each([
    [snapshot('signedIn'), 'signedIn'],
    [snapshot('signedIn', 'refreshing'), 'signedIn'],
    [snapshot('signedIn', 'signingOut'), 'signIn'],
    [snapshot('signedOut', 'signingOut'), 'signIn'],
    [snapshot('restoring'), 'signIn'],
    [snapshot('reauthRequired'), 'signIn'],
    [snapshot('storageBlocked'), 'signIn'],
  ] as const)('%o shows %s', (engineSnapshot, view) => {
    expect(rootView(engineSnapshot)).toBe(view);
  });
});
