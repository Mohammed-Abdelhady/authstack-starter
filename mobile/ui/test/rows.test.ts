import { AuthSessionError } from '@app/native-auth';
import { ApiError, TransportError } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { toApiFailure } from '../src/logic/request-failure';
import { sessionsView } from '../src/logic/session-rows';
import { session } from './support/fake-server';

/** Local noon, so the calendar-day cases hold in any time zone. */
const NOON = new Date(2026, 5, 10, 12, 0, 0).getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('the sessions list state', () => {
  it('is an error when the first answer fails, and keeps the reason', () => {
    const view = sessionsView({ sessions: undefined, failure: { kind: 'offline' }, now: NOON });

    expect({ view: view.view, failure: view.failure }).toEqual({
      view: 'error',
      failure: { kind: 'offline' },
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
