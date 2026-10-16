import { createBrowserTransport } from '@app/sdk';
import { API_BASE_URL } from '@/constants/api';

export const browserTransport = createBrowserTransport<AbortSignal>({
  baseUrl: API_BASE_URL,
  fetch: (url, init) => fetch(new Request(url, init)),
});
