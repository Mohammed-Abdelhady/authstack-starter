export const CSRF_HEADER = 'x-csrf-token';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * A session proof may be reused for the life of the session. A pre-session
 * proof is single-use: the server marks it spent on first use, so it must be
 * dropped once it has been attached to a request.
 */
export type BrowserProofKind = 'session' | 'pre-session';

interface HeldBrowserProof {
  token: string;
  kind: BrowserProofKind;
}

/**
 * What the last csrf lookup saw. While it says `no-session`, proof loading
 * skips the doomed csrf call and goes straight for a pre-session proof.
 */
export type CsrfLookup = 'unknown' | 'no-session';

let heldProof: HeldBrowserProof | null = null;
let csrfLookup: CsrfLookup = 'unknown';

export function currentBrowserProof(): string {
  return heldProof?.token ?? '';
}

export function csrfLookupHint(): CsrfLookup {
  return csrfLookup;
}

export function rememberNoSession(): void {
  if (heldProof?.kind === 'session') {
    heldProof = null;
  }
  csrfLookup = 'no-session';
}

/** A validated session invalidates only the signed-out hint and pre-session proof. */
export function rememberSessionPresent(): void {
  if (heldProof?.kind === 'pre-session') {
    heldProof = null;
  }
  csrfLookup = 'unknown';
}

export function rememberBrowserProof(
  headerValue: string | null | undefined,
  kind: BrowserProofKind,
): void {
  if (headerValue) {
    heldProof = { token: headerValue, kind };
    if (kind === 'session') {
      csrfLookup = 'unknown';
    }
  }
}

/**
 * Returns the token to attach to a request. A pre-session proof is consumed
 * here because it can only be spent once; a session proof is kept.
 */
export function takeBrowserProof(): string {
  if (!heldProof) {
    return '';
  }
  const { token, kind } = heldProof;
  if (kind === 'pre-session') {
    heldProof = null;
  }
  return token;
}

export function clearBrowserProof(): void {
  heldProof = null;
  csrfLookup = 'unknown';
}

export function methodNeedsBrowserProof(method: string | undefined): boolean {
  return UNSAFE_METHODS.has((method ?? 'GET').toUpperCase());
}
