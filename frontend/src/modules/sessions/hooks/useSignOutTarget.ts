import { useCallback, useState } from 'react';
import type { SignOutTarget } from '../components/SessionSignOutDialog';

/**
 * Which session a sign-out is being confirmed for. The target is captured
 * when the confirmation opens and kept while it closes, so the dialog never
 * names another session.
 */
export function useSignOutTarget() {
  const [target, setTarget] = useState<SignOutTarget | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const ask = useCallback((next: SignOutTarget) => {
    setTarget(next);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);

  return { target, isOpen, ask, close };
}
