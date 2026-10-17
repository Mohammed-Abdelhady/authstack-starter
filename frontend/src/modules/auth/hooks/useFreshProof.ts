import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import type { RootState } from '@/store/store';
import { useSingleFlight } from '@/hooks/useSingleFlight';
import { showsOwnRefusal } from '@/lib/refusal';
// feature:passkeys:start
import { assertPasskey } from '@/modules/passkeys/utils/webauthn';
// feature:passkeys:end
import {
  useInvitationProofOptionsMutation, // feature:passkeys
  useSendInvitationProofCodeMutation,
  useVerifyInvitationPasskeyMutation, // feature:passkeys
  useVerifyInvitationProofCodeMutation,
} from '../api/freshProofApi';
import { PROOF_ACTION, PROOF_CODE_PATTERN } from '../constants/staff-operation';

type PendingProof = (typeof PROOF_ACTION)[keyof typeof PROOF_ACTION];

function useProofSession() {
  const store = useStore<RootState>();
  const session = useRef(store.getState().auth);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => {
    const auth = store.getState().auth;
    return (
      mounted.current &&
      auth.sessionGeneration === session.current.sessionGeneration &&
      auth.user?.id === session.current.user?.id
    );
  }, [store]);
}

interface EmailProofActions {
  isCurrent: () => boolean;
  perform: (pending: PendingProof, action: () => Promise<void>) => Promise<void | undefined>;
  onProved: () => Promise<unknown>;
}

function useEmailProof({ isCurrent, perform, onProved }: EmailProofActions) {
  const [sendCode] = useSendInvitationProofCodeMutation();
  const [verifyCode] = useVerifyInvitationProofCodeMutation();
  const [expires, setExpires] = useState<number | null>(null);
  const send = useCallback(
    () =>
      perform(PROOF_ACTION.SEND_CODE, async () => {
        const response = await showsOwnRefusal(sendCode()).unwrap();
        if (isCurrent()) setExpires(response.expiresInMinutes);
      }),
    [isCurrent, perform, sendCode],
  );

  const email = useCallback(
    (code: string) =>
      perform(PROOF_ACTION.VERIFY_CODE, async () => {
        if (!PROOF_CODE_PATTERN.test(code)) return;
        await showsOwnRefusal(verifyCode({ code })).unwrap();
        if (isCurrent()) await onProved();
      }),
    [isCurrent, onProved, perform, verifyCode],
  );

  return { send, email, expires };
}

export function useFreshProof(onProved: () => Promise<unknown>) {
  const isCurrent = useProofSession();
  // feature:passkeys:start
  const [options] = useInvitationProofOptionsMutation();
  const [verifyPasskey] = useVerifyInvitationPasskeyMutation();
  // feature:passkeys:end
  const [pendingAction, setPendingAction] = useState<PendingProof | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [browserFailed, setBrowserFailed] = useState(false);

  const perform = useSingleFlight(
    useCallback(
      async (pending: PendingProof, action: () => Promise<void>) => {
        if (!isCurrent()) return;
        setPendingAction(pending);
        setError(null);
        setBrowserFailed(false);
        try {
          await action();
        } catch (failure) {
          if (isCurrent()) setError(failure);
        } finally {
          if (isCurrent()) setPendingAction(null);
        }
      },
      [isCurrent],
    ),
  );

  const { send, email, expires } = useEmailProof({ isCurrent, perform, onProved });

  // feature:passkeys:start
  const passkey = useCallback(
    () =>
      perform(PROOF_ACTION.PASSKEY, async () => {
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

  // feature:passkeys:end
  return {
    send,
    email,
    busy: pendingAction !== null,
    pendingAction,
    error,
    browserFailed,
    expires,
    passkey, // feature:passkeys
  };
}
