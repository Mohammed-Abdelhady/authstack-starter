import { useEffect, useRef, useState } from 'react';
import type { InvitationPurpose } from '../types/invitation.types';

export function useInvitationLink() {
  const read = useRef(false);
  const [link, setLink] = useState<{ token: string; purpose: InvitationPurpose } | null>(null);
  useEffect(() => {
    if (read.current) return;
    read.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search,
    );
    const rawPurpose = fragment.get('purpose');
    const purpose: InvitationPurpose =
      rawPurpose === 'first_admin' || rawPurpose === 'enrolment' ? rawPurpose : 'account';
    const captured = { token: fragment.get('token')?.trim() ?? '', purpose };
    queueMicrotask(() => setLink(captured));
  }, []);
  return link;
}
