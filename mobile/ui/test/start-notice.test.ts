import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartNotice } from '../src/components/StartNotice';
import { MESSAGES } from '../src/i18n';
import { startingNotice } from '../src/logic/host';
import { byRole, cleanup, flush, render } from './support/render';

vi.mock('react-native', () => import('./support/react-native'));

afterEach(cleanup);

describe('what a shell shows while it prepares', () => {
  it.each([
    ['en', 'ltr'],
    ['ar', 'rtl'], // feature:locale-ar
  ] as const)('reads the catalogue of %s in the direction %s', (locale, direction) => {
    expect(startingNotice(locale)).toEqual({
      text: MESSAGES[locale]['common.starting'],
      direction,
    });
  });
});

describe('the shell startup message', () => {
  it('exposes a startup failure as an alert and leaves progress as ordinary text', async () => {
    const failure = render(
      createElement(StartNotice, {
        text: MESSAGES.en['common.serverError'],
        direction: 'ltr',
        topInset: 0,
        alert: true,
      }),
    );
    await flush();
    expect(byRole(failure, 'alert')).toHaveLength(1);

    cleanup();
    const progress = render(
      createElement(StartNotice, {
        text: MESSAGES.en['common.starting'],
        direction: 'ltr',
        topInset: 0,
      }),
    );
    await flush();
    expect(byRole(progress, 'alert')).toEqual([]);
  });
});
