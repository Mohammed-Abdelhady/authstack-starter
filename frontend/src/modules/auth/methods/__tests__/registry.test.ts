import { describe, expect, it } from 'vitest';
import { AUTH_METHOD_ID } from '../../constants/authMethods'; // feature:email-password,magic-link,passkeys
import type { AuthMethods } from '@app/sdk';
import { enabledAuthMethods } from '../registry';

function methods(overrides: Partial<AuthMethods> = {}): AuthMethods {
  return {
    password: false,
    magicLink: false,
    twoFactor: false,
    passkeys: false,
    oauth: [],
    ...overrides,
  };
}

const idsFor = (value: AuthMethods): string[] => enabledAuthMethods(value).map((e) => e.id);

describe('enabledAuthMethods', () => {
  it('renders nothing when the backend reports no method', () => {
    expect(idsFor(methods())).toEqual([]);
  });

  // feature:email-password:start
  it('renders only the password form when only passwords are on', () => {
    expect(idsFor(methods({ password: true }))).toEqual([AUTH_METHOD_ID.PASSWORD]);
  });
  // feature:email-password:end

  // feature:magic-link:start
  it('renders only the magic link form when only links are on', () => {
    expect(idsFor(methods({ magicLink: true }))).toEqual([AUTH_METHOD_ID.MAGIC_LINK]);
  });
  // feature:magic-link:end

  // feature:passkeys:start
  it('renders only the passkey button when only passkeys are on', () => {
    expect(idsFor(methods({ passkeys: true }))).toEqual([AUTH_METHOD_ID.PASSKEYS]);
  });
  // feature:passkeys:end

  // feature:email-password:start
  // feature:magic-link:start
  it('puts the password form above the magic link form', () => {
    expect(idsFor(methods({ password: true, magicLink: true }))).toEqual([
      AUTH_METHOD_ID.PASSWORD,
      AUTH_METHOD_ID.MAGIC_LINK,
    ]);
  });
  // feature:magic-link:end
  // feature:email-password:end

  // feature:passkeys:start
  // feature:magic-link:start
  it('opens on the passkey button where passwords are off', () => {
    expect(idsFor(methods({ passkeys: true, magicLink: true }))).toEqual([
      AUTH_METHOD_ID.PASSKEYS,
      AUTH_METHOD_ID.MAGIC_LINK,
    ]);
  });
  // feature:magic-link:end
  // feature:passkeys:end

  // feature:email-password:start
  // feature:passkeys:start
  it('keeps the password form first where passwords are on', () => {
    expect(idsFor(methods({ password: true, passkeys: true }))).toEqual([
      AUTH_METHOD_ID.PASSWORD,
      AUTH_METHOD_ID.PASSKEYS,
    ]);
  });
  // feature:passkeys:end
  // feature:email-password:end

  // feature:email-password:start
  // feature:passkeys:start
  // feature:magic-link:start
  it('orders all three password, passkey, magic link', () => {
    expect(idsFor(methods({ password: true, passkeys: true, magicLink: true }))).toEqual([
      AUTH_METHOD_ID.PASSWORD,
      AUTH_METHOD_ID.PASSKEYS,
      AUTH_METHOD_ID.MAGIC_LINK,
    ]);
  });
  // feature:magic-link:end
  // feature:passkeys:end
  // feature:email-password:end

  it('ignores OAuth and the second factor, which the page renders itself', () => {
    const oauthOnly = methods({ oauth: [{ id: 'google', displayName: 'Google' }] });
    expect(idsFor(oauthOnly)).toEqual([]);
    expect(idsFor(methods({ twoFactor: true }))).toEqual([]);
  });

  it('renders nothing extra for a method the registry does not carry', () => {
    expect(
      idsFor(methods({ twoFactor: true, oauth: [{ id: 'github', displayName: 'GitHub' }] })),
    ).toEqual([]);
  });
});
