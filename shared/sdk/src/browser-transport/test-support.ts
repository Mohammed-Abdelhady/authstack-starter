import type { BrowserFetch, BrowserFetchInit, BrowserFetchResponse } from './types';
import type { TransportSignal } from '../transport';

export interface SentRequest {
  url: string;
  init: BrowserFetchInit<TransportSignal>;
}

export function reply(
  body: unknown = { success: true, data: {} },
  status = 200,
  token?: string,
): BrowserFetchResponse {
  return {
    status,
    headers: { get: (name) => (name === 'x-csrf-token' ? (token ?? null) : null) },
    text: async () => JSON.stringify(body),
  };
}

export function refusal(code: string, status = 403): BrowserFetchResponse {
  return reply({ success: false, error: { code, message: 'refused' } }, status);
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Promise not initialized');
  };
  let reject: (cause: unknown) => void = () => {
    throw new Error('Promise not initialized');
  };
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

export function network(...answers: (BrowserFetchResponse | Error)[]) {
  const sent: SentRequest[] = [];
  const fetch: BrowserFetch = async (url, init) => {
    sent.push({ url, init });
    const answer = answers.shift();
    if (!answer) throw new Error('Unexpected request');
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetch, sent };
}
