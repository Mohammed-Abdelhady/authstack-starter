import { describe, expect, it } from 'vitest';
import {
  clearBrowserProof,
  currentBrowserProof,
  csrfLookupHint,
  methodNeedsBrowserProof,
  rememberBrowserProof,
  rememberNoSession,
  rememberSessionPresent,
  takeBrowserProof,
} from '../browser-proof';

describe('browser proof memory', () => {
  it('keeps a session proof across requests and drops a pre-session proof once taken', () => {
    clearBrowserProof();
    rememberBrowserProof(null, 'session');
    expect(currentBrowserProof()).toBe('');
    rememberBrowserProof('proof-1', 'session');
    expect(currentBrowserProof()).toBe('proof-1');
    expect(takeBrowserProof()).toBe('proof-1');
    expect(takeBrowserProof()).toBe('proof-1');

    rememberBrowserProof('pre-1', 'pre-session');
    expect(currentBrowserProof()).toBe('pre-1');
    expect(takeBrowserProof()).toBe('pre-1');
    expect(takeBrowserProof()).toBe('');
    expect(currentBrowserProof()).toBe('');
  });

  it('ignores empty values and clears on demand', () => {
    clearBrowserProof();
    rememberBrowserProof('proof-1', 'session');
    rememberBrowserProof('', 'session');
    rememberBrowserProof(null, 'pre-session');
    expect(currentBrowserProof()).toBe('proof-1');
    clearBrowserProof();
    expect(currentBrowserProof()).toBe('');
  });

  it('asks for a proof only on unsafe methods', () => {
    expect(methodNeedsBrowserProof(undefined)).toBe(false);
    expect(methodNeedsBrowserProof('get')).toBe(false);
    expect(methodNeedsBrowserProof('POST')).toBe(true);
    expect(methodNeedsBrowserProof('delete')).toBe(true);
  });

  it('drops a held session proof when the server confirms there is no session', () => {
    clearBrowserProof();
    rememberBrowserProof('session-proof', 'session');

    rememberNoSession();

    expect(currentBrowserProof()).toBe('');
    expect(csrfLookupHint()).toBe('no-session');
  });

  it('keeps a pre-session proof while recording that the browser is signed out', () => {
    clearBrowserProof();
    rememberBrowserProof('pre-session-proof', 'pre-session');

    rememberNoSession();

    expect(currentBrowserProof()).toBe('pre-session-proof');
    expect(csrfLookupHint()).toBe('no-session');
  });

  it('keeps a session proof and clears the signed-out hint after identity confirms a session', () => {
    clearBrowserProof();
    rememberBrowserProof('session-proof', 'session');

    rememberSessionPresent();

    expect(currentBrowserProof()).toBe('session-proof');
    expect(csrfLookupHint()).toBe('unknown');
  });

  it('drops a pre-session proof after identity confirms a signed-in session', () => {
    clearBrowserProof();
    rememberBrowserProof('pre-session-proof', 'pre-session');

    rememberSessionPresent();

    expect(currentBrowserProof()).toBe('');
    expect(csrfLookupHint()).toBe('unknown');
  });
});
