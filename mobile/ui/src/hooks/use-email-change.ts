import { createApiClient, type OwnEmail } from '@app/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_TAG, LIST_VIEW, type ListView } from '../constants';
import {
  EMAIL_CODE_LENGTH,
  EMAIL_OUTCOME,
  EMAIL_STEP,
  type EmailOutcome,
  type EmailStep,
} from '../constants/email-change';
import { useUi } from '../context/ui-context';
import { emailNotice, outcomeOfFailure, type EmailNotice } from '../logic/email-change';
import { validNativeEmail } from '../logic/native-form-validation';
import { toApiFailure } from '../logic/request-failure';
import { uiApi } from '../state/api';
import type { ApiFailure } from '../types';

const CODE_SHAPE = new RegExp(`^\\d{${EMAIL_CODE_LENGTH}}$`);

/** The address the account has, the one it waits for, and the steps between. */
export function useEmailChange() {
  const { runtime, t } = useUi();
  const client = useMemo(() => createApiClient(runtime.engine.transport), [runtime.engine]);
  const [view, setView] = useState<ListView>(LIST_VIEW.LOADING);
  const [current, setCurrent] = useState<string>();
  const [pending, setPending] = useState<string>();
  const [step, setStep] = useState<EmailStep>(EMAIL_STEP.IDLE);
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<EmailNotice>();
  // Blocks a second press before the busy state reaches the screen.
  const inFlight = useRef(false);

  const tell = useCallback(
    (outcome: EmailOutcome, about = '') => setNotice(emailNotice(t, outcome, about)),
    [t],
  );

  const apply = useCallback((state: OwnEmail) => {
    setCurrent(state.email);
    setPending(state.pendingEmail);
  }, []);

  /** One call at a time. An answer for an account that has since left is dropped. */
  const run = useCallback(
    async <T>(
      call: () => Promise<T>,
      done: (value: T) => void,
      failed: (failure: ApiFailure) => void,
    ) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      const epoch = runtime.epoch.current();
      try {
        const value = await call();
        if (runtime.epoch.current() === epoch) done(value);
      } catch (error) {
        if (runtime.epoch.current() === epoch) failed(toApiFailure(error));
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [runtime.epoch],
  );

  const load = useCallback(() => {
    setView(LIST_VIEW.LOADING);
    void run(
      () => client.account.email.get(),
      (state) => {
        apply(state);
        setStep(state.pendingEmail === undefined ? EMAIL_STEP.IDLE : EMAIL_STEP.AWAITING_CODE);
        setView(LIST_VIEW.READY);
      },
      () => setView(LIST_VIEW.ERROR),
    );
  }, [apply, client, run]);

  useEffect(load, [load]);

  const start = useCallback(() => {
    setNotice(undefined);
    setAddress('');
    setCode('');
    setStep(EMAIL_STEP.EDITING);
  }, []);

  const stopEditing = useCallback(() => {
    setNotice(undefined);
    setStep(pending === undefined ? EMAIL_STEP.IDLE : EMAIL_STEP.AWAITING_CODE);
  }, [pending]);

  const send = useCallback(() => {
    const wanted = address.trim().toLowerCase();
    if (!validNativeEmail(wanted) || wanted === current) {
      tell(EMAIL_OUTCOME.INVALID_ADDRESS);
      return;
    }
    void run(
      () => client.account.email.request(wanted),
      (state) => {
        apply(state);
        setCode('');
        setStep(EMAIL_STEP.AWAITING_CODE);
        tell(EMAIL_OUTCOME.SENT, wanted);
      },
      (failure) => tell(outcomeOfFailure(failure), wanted),
    );
  }, [address, apply, client, current, run, tell]);

  const confirm = useCallback(() => {
    const typed = code.trim();
    if (!CODE_SHAPE.test(typed)) {
      tell(EMAIL_OUTCOME.CODE_REFUSED);
      return;
    }
    void run(
      () => client.account.email.confirm(typed),
      (state) => {
        apply(state);
        setCode('');
        setStep(EMAIL_STEP.IDLE);
        tell(EMAIL_OUTCOME.CHANGED);
        // The account screen reads the address from the profile.
        runtime.store.dispatch(uiApi.util.invalidateTags([API_TAG.PROFILE]));
      },
      (failure) => tell(outcomeOfFailure(failure)),
    );
  }, [apply, client, code, run, runtime.store, tell]);

  const keepCurrent = useCallback(() => {
    void run(
      () => client.account.email.cancel(),
      (state) => {
        apply(state);
        setCode('');
        setStep(EMAIL_STEP.IDLE);
        tell(EMAIL_OUTCOME.CANCELLED);
      },
      (failure) => tell(outcomeOfFailure(failure)),
    );
  }, [apply, client, run, tell]);

  return {
    view,
    current,
    pending,
    step,
    address,
    code,
    busy,
    notice,
    setAddress,
    setCode,
    retry: load,
    start,
    stopEditing,
    send,
    confirm,
    keepCurrent,
  };
}
