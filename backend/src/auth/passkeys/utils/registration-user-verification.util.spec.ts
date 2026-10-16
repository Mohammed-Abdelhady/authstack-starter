import {
  RegistrationPolicy,
  registrationRequiresUserVerification,
  registrationUserVerification,
} from './registration-user-verification.util';

type Case = [string, RegistrationPolicy, boolean, 'required' | 'preferred'];

const CASES: Case[] = [
  [
    'a native registration with nothing else set, so an app passkey always verifies its user',
    { ceremony: 'native', requirePasskey: false, enrolment: false },
    true,
    'required',
  ],
  [
    'a browser registration with nothing set, so a touch-only key still registers as today',
    { ceremony: 'browser', requirePasskey: false, enrolment: false },
    false,
    'preferred',
  ],
  [
    'a browser registration for an application that requires a passkey',
    { ceremony: 'browser', requirePasskey: true, enrolment: false },
    true,
    'required',
  ],
  [
    'a browser registration on an enrolment session',
    { ceremony: 'browser', requirePasskey: false, enrolment: true },
    true,
    'required',
  ],
];

describe('registrationRequiresUserVerification', () => {
  it.each(CASES)('decides %s', (_label, policy, required, requirement) => {
    expect(registrationRequiresUserVerification(policy)).toBe(required);
    expect(registrationUserVerification(policy)).toBe(requirement);
  });
});
