import type { CallOptions } from '../client';
import { HTTP_METHOD } from '../constants';
import { unwrapBrowserEmailCodeRequest, unwrapBrowserEmailCodeResult } from '../email-code/parsers';
import type { TransportSignal } from '../transport';
import type { BrowserEmailCodeRequest, BrowserEmailCodeResult } from '../types/browser-email-code';
import type { AreaSenders } from './shared';

export const BROWSER_EMAIL_CODE_PATHS = {
  request: '/api/auth/email-code/request',
  verify: '/api/auth/email-code/verify',
} as const;

export interface ApiClientBrowserEmailCode<TSignal extends TransportSignal = TransportSignal> {
  emailCode: {
    request(
      body: BrowserEmailCodeRequest,
      options?: CallOptions<TSignal>,
    ): Promise<{ email: string }>;
    verify(body: { code: string }, options?: CallOptions<TSignal>): Promise<BrowserEmailCodeResult>;
  };
}

export function createBrowserEmailCodeArea<TSignal extends TransportSignal>({
  send,
}: AreaSenders<TSignal>): ApiClientBrowserEmailCode<TSignal> {
  return {
    emailCode: {
      request: async (body, options) =>
        unwrapBrowserEmailCodeRequest(
          await send(
            { method: HTTP_METHOD.POST, path: BROWSER_EMAIL_CODE_PATHS.request, body },
            options,
          ),
        ),
      verify: async (body, options) =>
        unwrapBrowserEmailCodeResult(
          await send(
            { method: HTTP_METHOD.POST, path: BROWSER_EMAIL_CODE_PATHS.verify, body },
            options,
          ),
        ),
    },
  };
}
