'use client';

import { useCallback, useMemo, useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useFormWithValidation } from '@/hooks/useFormWithValidation';
import { useActivateMutation, useResendActivationMutation } from '../store/authApi';
import { toast } from '@/lib/toast';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { useFormFieldTarget, useServerFieldErrors } from '@/hooks/useServerFieldErrors';
import { useCompleteSignIn } from './useCompleteSignIn';
import { getRedirectPath } from '../utils/authHelpers';
import {
  REDIRECT_PARAM,
  VERIFICATION_CODE_LENGTH,
  RESEND_COOLDOWN_SECONDS,
} from '../constants/authMethods';
import { rememberRegistrationEmail } from '../store/authSlice';
import { ErrorCode, parseApiError } from '@app/core';
import { translatableErrorCode } from '../utils/errorCodeMessage';
import { filterDigits } from '../utils/digitFilter';
import { createActivationSchema } from '../utils/activationSchema';
import type { z } from 'zod';
import { useSharedSingleFlight } from '@/hooks/useSingleFlight';

type ActivationFormData = z.infer<ReturnType<typeof createActivationSchema>>;

export function useActivationForm() {
  const t = useTranslations('auth.activate');
  const tPassword = useTranslations('auth.passwordRules.errors');
  const tToast = useTranslations('toast');
  const tCodes = useTranslations('errors.codes');
  const completeSignIn = useCompleteSignIn();
  const searchParams = useSearchParams();
  const dispatch = useAppDispatch();
  const [activate, { isLoading }] = useActivateMutation();
  const [resendActivation, { isLoading: isResending }] = useResendActivationMutation();
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [showRegisterAgain, setShowRegisterAgain] = useState(false);
  const [mustSignIn, setMustSignIn] = useState(false);

  const emailInMemory = useAppSelector((state) => state.auth.pendingRegistrationEmail ?? '');
  const redirect = getRedirectPath(searchParams.get(REDIRECT_PARAM), '');

  const activationSchema = useMemo(() => createActivationSchema(t, tPassword), [t, tPassword]);

  const form = useFormWithValidation({
    schema: activationSchema,
    mode: 'onBlur',
    defaultValues: {
      email: emailInMemory,
      code: '',
      name: '',
      password: '',
      confirmPassword: '',
    },
  });

  const { setError, getValues, trigger, reset } = form;

  const formRef = useRef<HTMLFormElement>(null);
  const applyServerFieldErrors = useServerFieldErrors(
    useFormFieldTarget(setError, formRef),
    isLoading || isResending,
  );

  // Cooldown timer effect
  useEffect(() => {
    if (cooldownSeconds > 0) {
      const timer = setTimeout(() => {
        setCooldownSeconds((prev) => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldownSeconds]);

  const exclusive = useSharedSingleFlight();

  const submit = useCallback(
    async (data: ActivationFormData) => {
      try {
        const result = await activate({
          email: data.email,
          code: data.code,
          name: data.name,
          password: data.password,
        }).unwrap();

        dispatch(rememberRegistrationEmail(null));
        if (result.mustSignIn) {
          reset();
          setMustSignIn(true);
          return;
        }
        toast.success(tToast('success.activationSuccess'));
        await completeSignIn(result, redirect);
      } catch (err: unknown) {
        applyServerFieldErrors(err);
        const parsed = parseApiError(err);
        const code = translatableErrorCode(err, '');
        // The server answers one code for a wrong, missing, expired or locked
        // code. The person gets one message and can request a new code below.
        let errorMessage = t('errors.serverError');

        if (code) errorMessage = tCodes(code);

        if (parsed.code === ErrorCode.ACTIVATION_CODE_INVALID) {
          setShowRegisterAgain(true);
        }

        setError('root', {
          type: 'manual',
          message: errorMessage,
        });
      }
    },
    [
      activate,
      applyServerFieldErrors,
      completeSignIn,
      dispatch,
      redirect,
      reset,
      setError,
      t,
      tCodes,
      tToast,
    ],
  );

  const onSubmit = useCallback(
    (data: ActivationFormData) => exclusive(() => submit(data)),
    [exclusive, submit],
  );

  // Handle resend activation code
  const resend = useCallback(async () => {
    try {
      if (!(await trigger('email'))) return;
      await resendActivation({ email: getValues('email').trim().toLowerCase() }).unwrap();
      toast.success(tToast('success.resendSuccess'));
      setCooldownSeconds(RESEND_COOLDOWN_SECONDS);
    } catch (err: unknown) {
      applyServerFieldErrors(err);
      setError('root', { type: 'manual', message: tCodes(translatableErrorCode(err)) });
    }
  }, [applyServerFieldErrors, getValues, resendActivation, setError, tCodes, tToast, trigger]);

  const handleResend = useCallback(async () => {
    if (cooldownSeconds > 0) return;
    await exclusive(resend);
  }, [cooldownSeconds, exclusive, resend]);

  const handleCodeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.target.value = filterDigits(e.target.value, VERIFICATION_CODE_LENGTH);
  }, []);

  const isResendDisabled = isLoading || isResending || cooldownSeconds > 0;

  return {
    form,
    formRef,
    onSubmit,
    handleResend,
    handleCodeChange,
    isLoading,
    isResending,
    isResendDisabled,
    cooldownSeconds,
    showRegisterAgain,
    mustSignIn,
    emailInMemory,
    redirect,
  };
}
