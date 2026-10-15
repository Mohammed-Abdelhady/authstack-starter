import type { User } from '@app/sdk';
import type { AuthProfile, AuthSnapshot } from '../types/auth';
import type { NativeSafeAttemptView } from '../types/native-sign-in-actions';

export function freezeSnapshot(snapshot: AuthSnapshot): AuthSnapshot {
  const profile = snapshot.profile ? freezeUser(snapshot.profile) : undefined;
  const frozen: AuthSnapshot = {
    status: snapshot.status,
    operation: snapshot.operation,
    ...(snapshot.reason === undefined ? {} : { reason: snapshot.reason }),
    ...(snapshot.warning === undefined ? {} : { warning: snapshot.warning }),
    ...(profile === undefined ? {} : { profile }),
    ...(snapshot.nativeAttempt === undefined
      ? {}
      : { nativeAttempt: freezeNativeView(snapshot.nativeAttempt) }),
  };
  return Object.freeze(frozen);
}

export function sameSnapshot(left: AuthSnapshot, right: AuthSnapshot): boolean {
  return (
    left.status === right.status &&
    left.operation === right.operation &&
    left.reason === right.reason &&
    left.warning === right.warning &&
    left.profile === right.profile &&
    left.nativeAttempt === right.nativeAttempt
  );
}

function freezeUser(user: AuthProfile | User): AuthProfile {
  return Object.freeze({
    ...user,
    permissions: Object.freeze([...user.permissions]),
    linkedProviders: Object.freeze([...user.linkedProviders]),
  });
}

function freezeNativeView(view: NativeSafeAttemptView): NativeSafeAttemptView {
  switch (view.stage) {
    case 'firstFactorRequired':
      return Object.freeze({ ...view, factors: Object.freeze([...view.factors]) });
    case 'secondFactorRequired':
      return Object.freeze({ ...view, factors: Object.freeze([...view.factors]) });
    case 'consentRequired':
      return Object.freeze({
        ...view,
        account: Object.freeze({ ...view.account }),
        application: Object.freeze({
          ...view.application,
          scopes: Object.freeze([...view.application.scopes]),
        }),
      });
    default:
      return Object.freeze({ ...view });
  }
}
