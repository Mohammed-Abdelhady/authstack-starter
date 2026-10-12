import { AuthSessionError } from '@app/native-auth';
import { ApiError, TransportError } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { deviceNameOf } from '../src/logic/device-name';
import { toApiFailure } from '../src/logic/request-failure';
import { activityOf, sessionsView } from '../src/logic/session-rows';
import { session } from './support/fake-server';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile/15E148 Safari/604.1';
const WINDOWS_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0';
const ANDROID_APP = 'okhttp/4.12.0 (Linux; Android 16)';
const ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36';
const IOS_HTTP_CLIENT = 'Starter/42 CFNetwork/3826.500.111 Darwin/25.0.0';

/** Local noon, so the calendar-day cases hold in any time zone. */
const NOON = new Date(2026, 5, 10, 12, 0, 0).getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('what a session row is called', () => {
  it.each([
    [
      'a stored name wins',
      { deviceName: 'Work laptop', userAgent: WINDOWS_EDGE },
      false,
      { kind: 'named', name: 'Work laptop' },
    ],
    [
      'a blank stored name is ignored',
      { deviceName: '   ', userAgent: WINDOWS_EDGE },
      false,
      { kind: 'browser', browser: 'Edge', system: 'Windows' },
    ],
    [
      'an iPhone is not a Mac',
      { userAgent: IPHONE_SAFARI },
      false,
      { kind: 'browser', browser: 'Safari', system: 'iOS' },
    ],
    [
      'the app is named by its system alone',
      { userAgent: ANDROID_WEBVIEW },
      true,
      { kind: 'named', name: 'Android' },
    ],
    [
      'the same agent in a browser names the browser too',
      { userAgent: ANDROID_WEBVIEW },
      false,
      { kind: 'browser', browser: 'Chrome', system: 'Android' },
    ],
    [
      "the app's iOS HTTP client stands for iOS",
      { userAgent: IOS_HTTP_CLIENT },
      true,
      { kind: 'named', name: 'iOS' },
    ],
    [
      "the app's Android HTTP client stands for Android",
      { userAgent: 'okhttp/4.12.0' },
      true,
      { kind: 'named', name: 'Android' },
    ],
    [
      'an HTTP client is not a system for a browser session',
      { userAgent: 'okhttp/4.12.0' },
      false,
      { kind: 'unknown' },
    ],
    [
      'a system with no known browser',
      { userAgent: ANDROID_APP },
      false,
      { kind: 'named', name: 'Android' },
    ],
    [
      "the server's placeholder is not a name, so the app's agent names the device",
      {
        deviceName: 'Unknown device',
        userAgent: 'MobileExpo/1 CFNetwork/3896.100.1.2.1 Darwin/27.0.0',
      },
      true,
      { kind: 'named', name: 'iOS' },
    ],
    [
      "the server's placeholder over an agent that names nothing stays unknown",
      { deviceName: ' Unknown device ', userAgent: 'curl/8.9.1' },
      false,
      { kind: 'unknown' },
    ],
    [
      'a stored phrase spelled another way is kept as a name',
      { deviceName: 'unknown device', userAgent: 'curl/8.9.1' },
      false,
      { kind: 'named', name: 'unknown device' },
    ],
    [
      'a longer stored phrase that starts like the placeholder is kept',
      { deviceName: 'Unknown device 2', userAgent: 'curl/8.9.1' },
      false,
      { kind: 'named', name: 'Unknown device 2' },
    ],
    ['an agent that names nothing', { userAgent: 'curl/8.9.1' }, false, { kind: 'unknown' }],
    ['an empty agent', { userAgent: '' }, true, { kind: 'unknown' }],
  ] as const)('%s', (_name, input, isNativeApp, expected) => {
    expect(deviceNameOf(input, isNativeApp)).toEqual(expected);
  });
});

describe('how recently a session was used', () => {
  it.each([
    ['one second under five minutes', NOON - 5 * MINUTE + 1000, 'now'],
    ['exactly five minutes', NOON - 5 * MINUTE, 'today'],
    ['earlier the same day', NOON - 3 * HOUR, 'today'],
    ['the day before', NOON - 13 * HOUR, 'earlier'],
  ] as const)('%s', (_name, lastActiveAt, expected) => {
    expect(activityOf(lastActiveAt, NOON)).toBe(expected);
  });
});

describe('the sessions list state', () => {
  it('is loading until the first answer', () => {
    expect(sessionsView({ sessions: undefined, failure: undefined, now: NOON }).view).toBe(
      'loading',
    );
  });

  it('is an error when the first answer fails, and keeps the reason', () => {
    const view = sessionsView({ sessions: undefined, failure: { kind: 'offline' }, now: NOON });

    expect({ view: view.view, failure: view.failure }).toEqual({
      view: 'error',
      failure: { kind: 'offline' },
    });
  });

  it('is empty when only this device is signed in', () => {
    const view = sessionsView({
      sessions: [session('phone', { isCurrent: true })],
      failure: undefined,
      now: NOON,
    });

    expect({ view: view.view, current: view.current?.id, others: view.others }).toEqual({
      view: 'empty',
      current: 'phone',
      others: [],
    });
  });

  it('is empty for a list with no sessions at all', () => {
    const view = sessionsView({ sessions: [], failure: undefined, now: NOON });

    expect({ view: view.view, current: view.current }).toEqual({
      view: 'empty',
      current: undefined,
    });
  });

  it('sets this device apart and lists the others newest first', () => {
    const at = (offset: number) => new Date(NOON - offset).toISOString();
    const view = sessionsView({
      sessions: [
        session('old', { lastUsedAt: at(30 * HOUR) }),
        session('phone', { isCurrent: true, lastUsedAt: at(MINUTE) }),
        session('recent', { lastUsedAt: at(2 * MINUTE) }),
        session('never-used', { lastUsedAt: undefined, createdAt: at(2 * HOUR) }),
      ],
      failure: undefined,
      now: NOON,
    });

    expect({
      view: view.view,
      current: view.current?.id,
      others: view.others.map((row) => [row.id, row.activity]),
    }).toEqual({
      view: 'ready',
      current: 'phone',
      others: [
        ['recent', 'now'],
        ['never-used', 'today'],
        ['old', 'earlier'],
      ],
    });
  });

  it('reads an unreadable date as earlier, never as active now', () => {
    const view = sessionsView({
      sessions: [session('odd', { lastUsedAt: 'not a date' })],
      failure: undefined,
      now: NOON,
    });

    expect(view.others.map((row) => row.activity)).toEqual(['earlier']);
  });

  it('names the kind of session, and leaves an unknown kind unnamed', () => {
    const view = sessionsView({
      sessions: [
        session('a', {
          credentialPurpose: 'native_access',
          lastUsedAt: new Date(NOON - 1).toISOString(),
        }),
        session('b', { lastUsedAt: new Date(NOON - 2).toISOString() }),
        {
          ...session('c', { lastUsedAt: new Date(NOON - 3).toISOString() }),
          ...{ credentialPurpose: 'device_code' },
        },
      ] as Parameters<typeof sessionsView>[0]['sessions'],
      failure: undefined,
      now: NOON,
    });

    expect(view.others.map((row) => row.kind)).toEqual(['nativeApp', 'browser', undefined]);
  });
});

describe('what a failed request is reduced to', () => {
  it.each([
    ['no response', new TransportError(), { kind: 'offline' }],
    ['the session ended', new AuthSessionError(), { kind: 'signedOut' }],
    [
      'a refusal keeps its code and status',
      new ApiError({ status: 403, code: 'FORBIDDEN', message: 'no' }),
      { kind: 'refused', code: 'FORBIDDEN', status: 403 },
    ],
    ['an aborted request', new TransportError('aborted'), { kind: 'unknown' }],
    ['anything else', new Error('boom'), { kind: 'unknown' }],
  ] as const)('%s', (_name, error, expected) => {
    expect(toApiFailure(error)).toEqual(expected);
  });
});
