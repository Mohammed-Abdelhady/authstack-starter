import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AppProviders } from './AppProviders';

describe('AppProviders on the server', () => {
  it('sends the theme script with the page while the store gate still holds the page back', () => {
    const nonce = 'request-nonce-123';
    const html = renderToString(
      <AppProviders loadingLabel="Loading the page" nonce={nonce}>
        <main>page content</main>
      </AppProviders>,
    );

    // The gate renders its loading state only, so the script must sit above it.
    expect(html).toContain('data-testid="store-rehydration-loading"');
    expect(html).not.toContain('page content');
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain('prefers-color-scheme');
    expect(html).toContain(`nonce="${nonce}"`);
  });
});
