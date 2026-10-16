import type { TransportRequest, TransportResponse, TransportSignal } from '../../transport';

export interface IdentityFence<TSnapshot = unknown> {
  snapshot(): TSnapshot;
  isCurrent(snapshot: TSnapshot): boolean;
}

export interface BrowserFetchInit<TSignal extends TransportSignal> {
  method: string;
  headers: Readonly<Record<string, string>>;
  credentials: 'include';
  body?: string;
  signal?: TSignal;
}

export interface BrowserFetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface BrowserParsingFailure {
  originalStatus: number;
  data: string;
  error: string;
  unknownOutcome: boolean;
  operationKey?: string;
}

export interface BrowserResponse extends TransportResponse {
  parsingError?: BrowserParsingFailure;
  unknownOutcome?: boolean;
}

export type BrowserFetch<TSignal extends TransportSignal = TransportSignal> = (
  url: string,
  init: BrowserFetchInit<TSignal>,
) => Promise<BrowserFetchResponse>;

export interface BrowserTransportOptions<
  TSignal extends TransportSignal = TransportSignal,
  TSnapshot = unknown,
> {
  baseUrl?: string;
  fetch: BrowserFetch<TSignal>;
  identityFence?: IdentityFence<TSnapshot>;
}

export interface BrowserRequest<TSignal extends TransportSignal = TransportSignal> extends Omit<
  TransportRequest<TSignal>,
  'method'
> {
  method: string;
  operationKey?: string;
  identityFence?: IdentityFence;
}

export interface OperationHandle {
  readonly operationKey: string;
}

export type BrowserProofKind = 'session' | 'pre-session';
export type CsrfLookup = 'unknown' | 'no-session';

export interface BrowserProofControls {
  currentBrowserProof(): string;
  csrfLookupHint(): CsrfLookup;
  rememberNoSession(): void;
  rememberSessionPresent(): void;
  rememberBrowserProof(token: string | null | undefined, kind: BrowserProofKind): void;
  takeBrowserProof(): string;
  clearBrowserProof(): void;
}

export interface BrowserTransport<
  TSignal extends TransportSignal = TransportSignal,
> extends BrowserProofControls {
  request(request: BrowserRequest<TSignal>): Promise<BrowserResponse>;
}
