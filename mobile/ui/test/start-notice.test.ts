import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartNotice } from '../src/components/StartNotice';
import { MESSAGES } from '../src/i18n';
import { byRole, cleanup, flush, render } from './support/render';

vi.mock('react-native', () => import('./support/react-native'));

afterEach(cleanup);

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
