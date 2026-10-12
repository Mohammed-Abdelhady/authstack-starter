import { describe, expect, it } from 'vitest';
import { AR } from '../src/i18n/ar'; // feature:locale-ar
import { EN } from '../src/i18n/en';
import {
  placeholdersOf,
  resolveLocale,
  translate,
  type MessageArguments,
  type MessageKey,
  type Translate,
} from '../src/i18n';
import { signInActionText, signInNotice } from '../src/logic/sign-in-text';
import { deviceText, failureText, roleText } from '../src/logic/session-text';
import type { SignInView } from '../src/types';

const ARABIC_LETTER = /[؀-ۿ]/; // feature:locale-ar

/** Records the key and arguments asked for, so no test depends on the wording. */
function recorder() {
  const asked: [MessageKey, MessageArguments | undefined][] = [];
  const t: Translate = (key, values) => {
    asked.push([key, values]);
    return key;
  };
  return { asked, t };
}

describe('the catalogues', () => {
  it('finds unique sorted arguments and handles an argument-free message', () => {
    expect([placeholdersOf('{b} {a} {b}'), placeholdersOf('')]).toEqual([['a', 'b'], []]);
  });

  // feature:locale-ar:start
  it('hold the same keys', () => {
    expect(Object.keys(AR).sort()).toEqual(Object.keys(EN).sort());
  });

  it('take the same arguments for every key', () => {
    const differing = Object.keys(EN).filter(
      (key) =>
        placeholdersOf(EN[key as MessageKey]).join() !==
        placeholdersOf(AR[key as MessageKey] ?? '').join(),
    );

    expect(differing).toEqual([]);
  });
  // feature:locale-ar:end

  it('leave no message empty and none untranslated', () => {
    const empty = Object.entries({ ...EN }).filter(([, text]) => text.trim() === '');
    const untranslated = Object.entries(AR).filter(([, text]) => !ARABIC_LETTER.test(text)); // feature:locale-ar

    expect(empty).toEqual([]);
    expect(untranslated).toEqual([]); // feature:locale-ar
  });
});

describe('reading a message', () => {
  it('fills each argument in every language', () => {
    expect([
      translate('en', 'sessions.browserOnSystem', { browser: 'Edge', system: 'Windows' }),
      translate('ar', 'sessions.browserOnSystem', { browser: 'Edge', system: 'Windows' }), // feature:locale-ar
    ]).toEqual([
      EN['sessions.browserOnSystem'].replace('{browser}', 'Edge').replace('{system}', 'Windows'),
      AR['sessions.browserOnSystem'].replace('{browser}', 'Edge').replace('{system}', 'Windows'), // feature:locale-ar
    ]);
  });

  it('puts a value in as written, whatever characters it holds', () => {
    const text = translate('en', 'sessions.revokeLabel', { device: '$& {device} $1' });

    expect(text.endsWith('$& {device} $1')).toBe(true);
  });

  it('keeps the placeholder visible when its argument is missing', () => {
    expect(translate('en', 'sessions.address')).toContain('{ip}');
  });

  it.each([
    ['ar', 'ar'], // feature:locale-ar
    ['ar-SA', 'ar'], // feature:locale-ar
    ['AR_eg', 'ar'], // feature:locale-ar
    ['arc', 'en'],
    ['en-GB', 'en'],
    ['', 'en'],
    [undefined, 'en'],
  ] as const)('reads the locale tag %s as %s', (tag, locale) => {
    expect(resolveLocale(tag)).toBe(locale);
  });
});

describe('which message a state asks for', () => {
  const view = (overrides: Partial<SignInView>): SignInView => ({
    state: 'idle',
    action: 'signIn',
    canAct: true,
    sessionEnded: false,
    switchedOff: false,
    ...overrides,
  });

  it('gives the reason of a failed sign-in', () => {
    expect(signInNotice(view({ state: 'failed', failure: 'throttled' }))).toEqual({
      title: 'signIn.failed.title',
      description: 'signIn.failed.throttled',
    });
  });

  it('says nothing while idle and explains an ended session', () => {
    expect([signInNotice(view({})), signInNotice(view({ sessionEnded: true }))]).toEqual([
      undefined,
      { title: 'signIn.reauth.title', description: 'signIn.reauth.description' },
    ]);
  });

  it('labels the action by what it does next', () => {
    expect(
      (['idle', 'inProgress', 'offline', 'browserClosed'] as const).map((state) =>
        signInActionText(view({ state })),
      ),
    ).toEqual(['signIn.action', 'signIn.waiting', 'common.tryAgain', 'signIn.action']);
  });

  it('names a device from its browser and system', () => {
    const { asked, t } = recorder();

    deviceText(t, { kind: 'browser', browser: 'Edge', system: 'Windows' });
    deviceText(t, { kind: 'unknown' });

    expect(asked).toEqual([
      ['sessions.browserOnSystem', { browser: 'Edge', system: 'Windows' }],
      ['sessions.unknownDevice', undefined],
    ]);
    expect(deviceText(t, { kind: 'named', name: 'Work laptop' })).toBe('\u2066Work laptop\u2069');
  });

  it('translates a known role and shows a custom one as the server spells it', () => {
    const { t } = recorder();

    expect([roleText(t, 'admin'), roleText(t, 'night-shift')]).toEqual([
      'role.admin',
      '\u2066night-shift\u2069',
    ]);
  });

  it('tells an offline failure from a server one', () => {
    const { t } = recorder();

    expect([
      failureText(t, { kind: 'offline' }),
      failureText(t, { kind: 'refused', code: 'X', status: 500 }),
      failureText(t, undefined),
    ]).toEqual(['common.offline', 'common.serverError', 'common.serverError']);
  });
});
