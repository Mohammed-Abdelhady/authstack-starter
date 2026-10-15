import { browserTransport } from './browser-transport-instance';

export { CSRF_HEADER, methodNeedsBrowserProof } from '@app/sdk';
export type { BrowserProofKind, CsrfLookup } from '@app/sdk';

export const {
  currentBrowserProof,
  csrfLookupHint,
  rememberNoSession,
  rememberSessionPresent,
  rememberBrowserProof,
  takeBrowserProof,
  clearBrowserProof,
} = browserTransport;
