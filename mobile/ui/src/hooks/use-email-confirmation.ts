import { PortAbortController } from '@app/native-auth';
import { createApiClient } from '@app/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EMAIL_CODE_LENGTH } from '../constants/email-change';
import { useUi } from '../context/ui-context';
import { emailNotice, outcomeOfFailure } from '../logic/email-change';
import { validNativeEmail } from '../logic/native-form-validation';
import { toApiFailure } from '../logic/request-failure';
import { westernDigits } from '../logic/western-digits';
import type { EmailConfirmationProps } from '../types/email-confirmation';

const CODE = new RegExp(`^\\d{${EMAIL_CODE_LENGTH}}$`);

export function useEmailConfirmation({ clientId, transport }: EmailConfirmationProps) {
  const { t } = useUi();
  const client = useMemo(() => createApiClient(transport), [transport]);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState<ReturnType<typeof emailNotice>>();
  const pending = useRef<PortAbortController>(undefined);
  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = undefined;
    },
    [client, clientId],
  );

  const submit = useCallback(async () => {
    const address = email.trim().toLowerCase();
    if (pending.current || !validNativeEmail(address) || !CODE.test(code)) return;
    const controller = new PortAbortController();
    pending.current = controller;
    setBusy(true);
    setNotice(undefined);
    try {
      await client.account.email.confirmFromApp(
        { clientId, email: address, code },
        { signal: controller.signal },
      );
      if (pending.current === controller) {
        setConfirmed(true);
        setCode('');
      }
    } catch (error) {
      if (pending.current === controller)
        setNotice(emailNotice(t, outcomeOfFailure(toApiFailure(error))));
    } finally {
      if (pending.current === controller) {
        pending.current = undefined;
        setBusy(false);
      }
    }
  }, [client, clientId, code, email, t]);
  const changeCode = useCallback((value: string) => setCode(westernDigits(value)), []);
  return {
    email,
    setEmail,
    code,
    setCode: changeCode,
    busy,
    confirmed,
    notice,
    submit,
    valid: validNativeEmail(email.trim()) && CODE.test(code),
  };
}
