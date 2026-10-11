import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The server entry of the library refuses to load outside a server build.
vi.mock('next-intl/server', () => ({
  getRequestConfig: <Config>(create: Config): Config => create,
}));

import requestConfig from '../request';

const REQUEST_INSTANT = '2031-06-15T12:00:00.000Z';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(REQUEST_INSTANT) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('request configuration', () => {
  it.each([
    'en',
    'ar', // feature:locale-ar
  ])('hands the page the instant of the request in %s', async (locale) => {
    const config = await requestConfig({
      requestLocale: Promise.resolve(locale),
      locale: undefined,
    });

    expect({ locale: config.locale, now: config.now?.toISOString() }).toEqual({
      locale,
      now: REQUEST_INSTANT,
    });
  });
});
