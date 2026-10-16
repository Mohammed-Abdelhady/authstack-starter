import type { BrowserProofControls, BrowserProofKind, CsrfLookup } from './types';

export function createProofState(): BrowserProofControls {
  let heldProof: { token: string; kind: BrowserProofKind } | null = null;
  let csrfLookup: CsrfLookup = 'unknown';

  return {
    currentBrowserProof: () => heldProof?.token ?? '',
    csrfLookupHint: () => csrfLookup,
    rememberNoSession: () => {
      if (heldProof?.kind === 'session') heldProof = null;
      csrfLookup = 'no-session';
    },
    rememberSessionPresent: () => {
      if (heldProof?.kind === 'pre-session') heldProof = null;
      csrfLookup = 'unknown';
    },
    rememberBrowserProof: (token, kind) => {
      if (!token) return;
      heldProof = { token, kind };
      if (kind === 'session') csrfLookup = 'unknown';
    },
    takeBrowserProof: () => {
      if (!heldProof) return '';
      const { token, kind } = heldProof;
      if (kind === 'pre-session') heldProof = null;
      return token;
    },
    clearBrowserProof: () => {
      heldProof = null;
      csrfLookup = 'unknown';
    },
  };
}
