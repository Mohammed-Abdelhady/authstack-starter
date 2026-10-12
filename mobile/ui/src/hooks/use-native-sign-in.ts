import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import { NATIVE_AUTH_FLOW } from '@app/core';
import type { NativeFlow, NativeMethods } from '@app/sdk';
import type { NativeSignInAction, NativeSignInOutcome } from '@app/native-auth';
import { NATIVE_DISCOVERY, NATIVE_METHOD } from '../constants/native-sign-in';
import { useUi } from '../context/ui-context';
import type { MessageKey } from '../i18n';
import { nativeOutcomeMessage } from '../logic/native-sign-in-text';
import type { NativeUiMethod } from '../types/native-sign-in';
import type { EnginePort } from '../types';
import { useEngineSnapshot } from './use-engine-snapshot';

export function useNativeSignIn() {
  const { runtime, locale } = useUi();
  const { engine } = runtime;
  const snapshot = useEngineSnapshot(engine);
  const [methods, setMethods] = useState<NativeMethods>();
  const [discovery, setDiscovery] = useState<
    (typeof NATIVE_DISCOVERY)[keyof typeof NATIVE_DISCOVERY]
  >(NATIVE_DISCOVERY.LOADING);
  const [method, setMethod] = useState<NativeUiMethod>();
  const [pending, setPending] = useState(false);
  const [pendingFactor, setPendingFactor] = useState<string>();
  const [message, setMessage] = useState<MessageKey>();
  const [problem, setProblem] = useState(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const lock = useRef(false);
  const discoveryRequest = useRef<
    { engine: EnginePort; request: Promise<NativeMethods> } | undefined
  >(undefined);

  const methodsSource = useRef<EnginePort | undefined>(undefined);
  const load = useCallback(() => {
    setDiscovery(NATIVE_DISCOVERY.LOADING);
    const previous = discoveryRequest.current;
    const request =
      previous?.engine === engine
        ? previous.request
        : Promise.resolve().then(() => engine.methods());
    discoveryRequest.current = { engine, request };
    if (methodsSource.current !== engine) setMethods(undefined);
    void request
      .then(
        (answer) => {
          if (alive.current && discoveryRequest.current?.request === request) {
            methodsSource.current = engine;
            setMethods(answer);
            setDiscovery(NATIVE_DISCOVERY.READY);
          }
        },
        () => {
          if (alive.current && discoveryRequest.current?.request === request)
            setDiscovery(NATIVE_DISCOVERY.FAILED);
        },
      )
      .finally(() => {
        if (discoveryRequest.current?.request === request) discoveryRequest.current = undefined;
      });
  }, [engine]);

  useEffect(() => {
    alive.current = true;
    lock.current = false;
    setPending(false);
    setPendingFactor(undefined);
    setMethod(undefined);
    setMessage(undefined);
    setProblem(false);
    load();
    return () => {
      alive.current = false;
      generation.current += 1;
    };
  }, [load]);

  const finish = useCallback((outcome: NativeSignInOutcome, epoch: number) => {
    if (!alive.current || epoch !== generation.current) return;
    setMessage(nativeOutcomeMessage(outcome));
    setProblem(
      !['continue', 'signedIn', 'activationCompleted', 'recoveryComplete', 'cancelled'].includes(
        outcome.kind,
      ),
    );
    if (
      outcome.kind === 'recoveryComplete' ||
      outcome.kind === 'expired' ||
      outcome.kind === 'cancelled' ||
      (outcome.kind === 'activationCompleted' && !outcome.view)
    )
      setMethod(undefined);
    lock.current = false;
    setPending(false);
    setPendingFactor(undefined);
  }, []);

  const submit = useCallback(
    (action: NativeSignInAction) => {
      if (lock.current || snapshot.status === 'restoring' || snapshot.status === 'storageBlocked')
        return;
      lock.current = true;
      const epoch = ++generation.current;
      setPending(true);
      setMessage(undefined);
      void engine.nativeSignIn(action).then(
        (outcome) => finish(outcome, epoch),
        () => finish({ kind: 'apiFailure' }, epoch),
      );
    },
    [engine, finish, snapshot.status],
  );

  const begin = useCallback(
    (flow: NativeFlow, selection?: NativeUiMethod, next?: NativeSignInAction) => {
      if (lock.current || !methods?.nativeEnabled) return;
      const epoch = ++generation.current;
      lock.current = true;
      setPending(true);
      setMethod(selection);
      setPendingFactor(
        next?.kind === 'provider'
          ? next.providerId
          : next?.kind === 'passkey'
            ? 'passkey'
            : undefined,
      );
      setMessage(undefined);
      void (async () => {
        const result = await engine.nativeSignIn({ kind: 'start', flow });
        if (!alive.current || epoch !== generation.current || result.kind !== 'continue' || !next)
          return result;
        return engine.nativeSignIn(next);
      })().then(
        (outcome) => finish(outcome, epoch),
        () => finish({ kind: 'apiFailure' }, epoch),
      );
    },
    [engine, finish, methods],
  );

  const choose = useCallback(
    (selection: NativeUiMethod, email?: string) => {
      const registration = selection === NATIVE_METHOD.REGISTRATION;
      const recovery = selection === NATIVE_METHOD.RECOVERY;
      const flow = registration
        ? NATIVE_AUTH_FLOW.REGISTRATION
        : recovery
          ? NATIVE_AUTH_FLOW.RECOVERY
          : NATIVE_AUTH_FLOW.SIGN_IN;
      const next: NativeSignInAction | undefined = email
        ? registration
          ? { kind: 'register', email }
          : recovery
            ? { kind: 'requestRecovery', email }
            : undefined
        : undefined;
      begin(flow, selection, next);
    },
    [begin],
  );

  const cancel = useCallback(() => {
    const epoch = ++generation.current;
    lock.current = true;
    setPending(true);
    void engine.cancelNativeSignIn().then(
      (outcome) => {
        if (outcome.kind === 'cancelled' && alive.current && epoch === generation.current)
          setMethod(undefined);
        finish(outcome, epoch);
      },
      () => finish({ kind: 'storageFailure' }, epoch),
    );
  }, [engine, finish]);

  const web = useCallback(
    (flow: NativeFlow = NATIVE_AUTH_FLOW.SIGN_IN, providerId?: string) => {
      if (lock.current || methods?.nativeEnabled === false) return;
      const epoch = ++generation.current;
      lock.current = true;
      setPending(true);
      setMessage(undefined);
      void engine.signIn({ flow, locale, ...(providerId ? { providerId } : {}) }).then(
        (outcome) => {
          const result: NativeSignInOutcome =
            outcome.kind === 'signedIn'
              ? outcome
              : outcome.kind === 'cancelled' || outcome.kind === 'dismissed'
                ? { kind: 'cancelled' }
                : outcome.kind === 'transportFailure'
                  ? { kind: 'transportFailure' }
                  : { kind: 'apiFailure' };
          finish(result, epoch);
        },
        () => finish({ kind: 'apiFailure' }, epoch),
      );
    },
    [engine, finish, locale, methods],
  );

  const startFactor = useCallback(
    (action: 'passkey' | { providerId: string }) => {
      begin(
        NATIVE_AUTH_FLOW.SIGN_IN,
        undefined,
        action === 'passkey'
          ? { kind: 'passkey' }
          : { kind: 'provider', providerId: action.providerId, locale },
      );
    },
    [begin, locale],
  );

  const nested = method !== undefined || snapshot.nativeAttempt !== undefined;
  useEffect(() => {
    if (!nested) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      cancel();
      return true;
    });
    return () => subscription.remove();
  }, [cancel, nested]);

  return {
    methods,
    discovery,
    method,
    pending,
    pendingFactor,
    message,
    problem,
    view: snapshot.nativeAttempt,
    load,
    choose,
    submit,
    cancel,
    web,
    startFactor,
  };
}
