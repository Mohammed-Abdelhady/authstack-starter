import { getRequestConfig } from 'next-intl/server';
import { isAppLocale, loadMessages } from './load-messages';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isAppLocale(requested) ? requested : routing.defaultLocale;

  return {
    locale,
    // One instant per request, handed to the client, so both render the same year.
    now: new Date(),
    messages: await loadMessages(locale),
  };
});
