import { afterEach, beforeEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import { installNetworkGuard, takeUnhandledRequests } from './networkGuard';
import { clearBrowserProof } from '@/store/api/browser-proof';
import { loseFocusWhenDisabled } from './busyControls';

let stopFocusRule = () => {};

beforeEach(() => {
  takeUnhandledRequests();
  clearBrowserProof();
  installNetworkGuard();
  if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
    stopFocusRule = loseFocusWhenDisabled();
  }
});

afterEach(() => {
  stopFocusRule();
  stopFocusRule = () => {};
  cleanup();
  clearBrowserProof();
  installNetworkGuard();
  expect(takeUnhandledRequests()).toEqual([]);
});
