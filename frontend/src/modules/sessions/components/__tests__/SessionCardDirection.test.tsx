// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { Session } from '@app/sdk';
import { directionOf, registerRtlDocument } from '@/tests/direction';
import { registerFormTestLifecycle, renderForm } from '@/tests/serverRejectionHarness';
import { SessionCardTimeline } from '../SessionCardTimeline';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

/** The loopback address a local server reports, which a right-to-left line turns around. */
const LOOPBACK = '::1';

const SESSION: Session = {
  id: 'session-loopback',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ip: LOOPBACK,
  deviceName: 'Chrome 120 on macOS 10.15',
  createdAt: '2026-10-01T12:00:00.000Z',
  lastUsedAt: '2026-10-02T11:00:00.000Z',
  isCurrent: true,
  credentialPurpose: 'browser_session',
};

registerFormTestLifecycle();
registerRtlDocument();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('SessionCardTimeline technical values in an rtl page in %s', (locale) => {
  it('isolates the address left to right and leaves its row in the page direction', async () => {
    await renderForm(locale, <SessionCardTimeline session={SESSION} />);

    const address = screen.getByTestId('session-ip');
    expect({
      text: address.textContent,
      address: address.getAttribute('dir'),
      row: directionOf(screen.getByTestId('session-ip-row')),
    }).toEqual({ text: LOOPBACK, address: 'ltr', row: 'rtl' });
  });

  it('isolates the browser and system line left to right', async () => {
    await renderForm(locale, <SessionCardTimeline session={SESSION} />);

    const line = screen.getByTestId('session-browser-os');
    expect({ text: line.textContent, line: line.getAttribute('dir') }).toEqual({
      text: 'Chrome 120 · macOS 10.15',
      line: 'ltr',
    });
  });
});
