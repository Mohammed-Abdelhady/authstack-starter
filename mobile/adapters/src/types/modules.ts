/** The part of each native module an adapter calls. Tests fake these, never the ports. */

export interface SecureStoreOptionsApi {
  keychainAccessible?: number;
}

export interface SecureStoreApi {
  getItemAsync(key: string, options?: SecureStoreOptionsApi): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: SecureStoreOptionsApi): Promise<void>;
  deleteItemAsync(key: string, options?: SecureStoreOptionsApi): Promise<void>;
}

export interface WebBrowserSessionResult {
  type: string;
  url?: string | undefined;
}

export interface WebBrowserApi {
  openAuthSessionAsync(
    url: string,
    redirectUrl?: string | null,
    options?: { preferEphemeralSession?: boolean },
  ): Promise<WebBrowserSessionResult>;
  dismissAuthSession(): void;
}

export interface CryptoApi<TAlgorithm> {
  getRandomBytesAsync(byteCount: number): Promise<Uint8Array>;
  digest(algorithm: TAlgorithm, data: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer>;
}

export interface LinkingApi {
  getInitialURL(): Promise<string | null>;
  addEventListener(type: 'url', handler: (event: { url: string }) => void): { remove(): void };
}

export interface MarkerFileApi {
  readonly exists: boolean;
  create(): void;
}

/** The plain file kept beside the credential record. It goes when the record is deleted. */
export interface RecordMarkerApi extends MarkerFileApi {
  delete(): void;
}

export interface UuidApi {
  randomUUID(): string;
}

export interface ClockApi {
  date: { now(): number };
  performance: { now(): number };
}

export interface TimerApi<THandle> {
  setTimeout(handler: () => void, milliseconds: number): THandle;
  clearTimeout(handle: THandle): void;
}

export interface FetchInit<TSignal> {
  method: string;
  headers: Record<string, string>;
  body?: string | undefined;
  credentials: 'omit';
  signal: TSignal;
}

export interface FetchResponseApi {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface HttpApi<TSignal> {
  fetch(address: string, init: FetchInit<TSignal>): Promise<FetchResponseApi>;
  createAbort(): { signal: TSignal; abort(): void };
}
