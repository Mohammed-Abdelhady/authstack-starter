import type { ReactNode } from 'react';
import { FontsContext } from '../context/fonts-context';

export function FontsProvider({ ready, children }: { ready: boolean; children: ReactNode }) {
  return <FontsContext.Provider value={ready}>{children}</FontsContext.Provider>;
}
