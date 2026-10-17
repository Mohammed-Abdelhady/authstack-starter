import type { AbortSignalPort } from '@app/native-auth';
import { ApiError, type ApiClient } from '@app/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EMAIL_CODE_LENGTH } from '../constants/email-change';
import { useUi } from '../context/ui-context';
import type { MessageKey } from '../i18n';
import { reauthenticate } from '../logic/reauthenticate';
import { westernDigits } from '../logic/western-digits';

type Client = ApiClient<AbortSignalPort>;
interface PendingProof {
  resolve: (proved: boolean) => void;
  isCurrent: () => boolean;
}
const PROOF_CODE = new RegExp(`^[0-9]{${EMAIL_CODE_LENGTH}}$`);

function useProofSession() {
  const { runtime } = useUi();
  const epoch = runtime.epoch.current();
  const pending = useRef<PendingProof | null>(null);
  const flight = useRef(false);
  const [form, setForm] = useState({
    epoch,
    open: false,
    code: '',
    busy: false,
    notice: undefined as MessageKey | undefined,
  });
  useEffect(
    () => () => {
      const attempt = pending.current;
      pending.current = null;
      attempt?.resolve(false);
    },
    [epoch],
  );
  const close = useCallback((proved: boolean) => {
    const attempt = pending.current;
    pending.current = null;
    setForm((current) => ({ ...current, open: false, code: '', busy: false }));
    attempt?.resolve(proved);
  }, []);
  return { epoch, pending, flight, form, setForm, close, runtime };
}

type ProofSession = ReturnType<typeof useProofSession>;
function currentProof(
  session: ProofSession,
  attempt: PendingProof | null,
): attempt is PendingProof {
  return attempt !== null && session.pending.current === attempt && attempt.isCurrent();
}

function completeEmailProof(session: ProofSession, verify: boolean): void {
  if (verify) session.close(true);
  else session.setForm((current) => ({ ...current, code: '', notice: undefined }));
}

function useEmailActions({ session, client }: { session: ProofSession; client: Client }) {
  const { pending, flight, form, setForm } = session;
  const run = useCallback(
    async (verify: boolean) => {
      const attempt = pending.current;
      if (!currentProof(session, attempt) || flight.current) return;
      if (verify && !PROOF_CODE.test(form.code)) return;
      flight.current = true;
      setForm((current) => ({ ...current, busy: true, notice: undefined }));
      try {
        if (verify) await client.proof.verifyCode({ code: form.code });
        else await client.proof.sendCode();
        if (!currentProof(session, attempt)) return;
        completeEmailProof(session, verify);
      } catch {
        if (currentProof(session, attempt))
          setForm((current) => ({ ...current, notice: 'deletion.proofRefused' }));
      } finally {
        flight.current = false;
        if (currentProof(session, attempt)) setForm((current) => ({ ...current, busy: false }));
      }
    },
    [pending, flight, form.code, setForm, client, session],
  );
  return {
    submit: useCallback(() => void run(true), [run]),
    resend: useCallback(() => void run(false), [run]),
    setCode: useCallback(
      (value: string) =>
        setForm((current) => ({
          ...current,
          code: westernDigits(value)
            .replace(/[^0-9]/g, '')
            .slice(0, EMAIL_CODE_LENGTH),
        })),
      [setForm],
    ),
  };
}

export function useDeletionProof(client: Client) {
  const session = useProofSession();
  const { epoch, pending, setForm, close, runtime } = session;
  const actions = useEmailActions({ session, client });
  const authorize = useCallback(
    async (error: ApiError, isCurrent: () => boolean) => {
      const methods = error.details?.['methods'];
      if (!Array.isArray(methods) || !isCurrent()) return false;
      if (!methods.includes('email-code')) {
        return methods.includes('passkey') && (await reauthenticate(runtime.engine)) && isCurrent();
      }
      try {
        await client.proof.sendCode();
      } catch {
        return false;
      }
      if (!isCurrent()) return false;
      return new Promise<boolean>((resolve) => {
        pending.current = { resolve, isCurrent };
        setForm({ epoch, open: true, code: '', busy: false, notice: undefined });
      });
    },
    [client, runtime.engine, pending, setForm, epoch],
  );
  return {
    ...actions,
    authorize,
    open: session.form.epoch === epoch && session.form.open,
    code: session.form.code,
    busy: session.form.busy,
    notice: session.form.notice,
    valid: PROOF_CODE.test(session.form.code),
    cancel: useCallback(() => close(false), [close]),
  };
}
