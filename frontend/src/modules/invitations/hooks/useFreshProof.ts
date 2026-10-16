import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import type { RootState } from '@/store/store';
import { useSingleFlight } from '@/hooks/useSingleFlight';
import { showsOwnRefusal } from '@/lib/refusal';
import { assertPasskey } from '@/modules/passkeys/utils/webauthn';
import {
  useInvitationProofOptionsMutation,
  useSendInvitationProofCodeMutation,
  useVerifyInvitationPasskeyMutation,
  useVerifyInvitationProofCodeMutation,
} from '../api/invitationsApi';
import { PROOF_CODE_PATTERN } from '../constants/invitations';

export function useFreshProof(onProved: () => Promise<unknown>) {
  const store = useStore<RootState>();
  const session = useRef(store.getState().auth);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isCurrent = useCallback(() => {
    const auth = store.getState().auth;
    return (
      mounted.current &&
      auth.sessionGeneration === session.current.sessionGeneration &&
      auth.user?.id === session.current.user?.id
    );
  }, [store]);
  const [sendCode] = useSendInvitationProofCodeMutation();
  const [verifyCode] = useVerifyInvitationProofCodeMutation();
  const [options] = useInvitationProofOptionsMutation();
  const [verifyPasskey] = useVerifyInvitationPasskeyMutation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [browserFailed, setBrowserFailed] = useState(false);
  const [expires, setExpires] = useState<number | null>(null);

  const perform = useSingleFlight(
    useCallback(
      async (action: () => Promise<void>) => {
        if (!isCurrent()) return;
        setBusy(true);
        setError(null);
        setBrowserFailed(false);
        try {
          await action();
        } catch (failure) {
          if (isCurrent()) setError(failure);
        } finally {
          if (isCurrent()) setBusy(false);
        }
      },
      [isCurrent],
    ),
  );

  const send = useCallback(
    () =>
      perform(async () => {
        const response = await showsOwnRefusal(sendCode()).unwrap();
        if (isCurrent()) setExpires(response.expiresInMinutes);
      }),
    [isCurrent, perform, sendCode],
  );

  const email = useCallback(
    (code: string) =>
      perform(async () => {
        if (!PROOF_CODE_PATTERN.test(code)) return;
        await showsOwnRefusal(verifyCode({ code })).unwrap();
        if (isCurrent()) await onProved();
      }),
    [isCurrent, onProved, perform, verifyCode],
  );

  const passkey = useCallback(
    () =>
      perform(async () => {
        const requestOptions = await showsOwnRefusal(options()).unwrap();
        if (!isCurrent()) return;
        const assertion = await assertPasskey(requestOptions);
        if (!isCurrent()) return;
        if (!assertion.ok) {
          setBrowserFailed(true);
          return;
        }
        await showsOwnRefusal(verifyPasskey(assertion.value)).unwrap();
        if (isCurrent()) await onProved();
      }),
    [isCurrent, onProved, options, perform, verifyPasskey],
  );

  return { send, email, passkey, busy, error, browserFailed, expires };
}
