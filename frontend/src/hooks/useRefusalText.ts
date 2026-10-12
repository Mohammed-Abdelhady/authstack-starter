import { useCallback } from 'react';
import { useResolvedMessage } from '@/components/ui/LocalizedToastMessage';
import { refusalMessage } from '@/lib/refusal';

/**
 * Turns a failed request into the text to show for it, in the page's
 * language. It is the text the store's toast would have carried.
 */
export function useRefusalText(): (error: unknown) => string {
  const resolve = useResolvedMessage();
  return useCallback((error: unknown) => resolve(refusalMessage(error)), [resolve]);
}
