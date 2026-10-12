import { ReduxProvider } from './ReduxProvider';
import { ThemeProvider } from './ThemeProvider';

interface AppProvidersProps {
  readonly children: React.ReactNode;
  /** Announced while the persisted store rehydrates. */
  readonly loadingLabel: string;
  readonly nonce?: string;
}

/**
 * The providers every page sits under.
 *
 * The theme provider is outermost: the store gate renders only its loading
 * state on the server, and the theme script has to be in the server's HTML to
 * run before the first paint.
 */
export function AppProviders({ children, loadingLabel, nonce }: AppProvidersProps) {
  return (
    <ThemeProvider nonce={nonce}>
      <ReduxProvider loadingLabel={loadingLabel}>{children}</ReduxProvider>
    </ThemeProvider>
  );
}
