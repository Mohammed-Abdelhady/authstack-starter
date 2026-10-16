import { NATIVE_PROVIDER_SDK_MODE } from '@app/core';
import type { ProviderSignInPort } from '@app/native-auth';
import {
  createApiClient,
  PROVIDER_PRIMARY_HINT,
  PROVIDER_UNLINK_HINT,
  type LinkedProviders,
  type NativeProviderMethod,
} from '@app/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PROVIDER_EMAIL_ID } from '../constants/providers';
import { useUi } from '../context/ui-context';
import type { MessageKey } from '../i18n';
import { providerFailure } from '../logic/provider-text';

interface Notice {
  key: MessageKey;
  description?: string;
  signInAgain?: boolean;
}

export function useProviders(providerSignIn?: ProviderSignInPort) {
  const { runtime, t, confirm } = useUi();
  const client = useMemo(() => createApiClient(runtime.engine.transport), [runtime]);
  const [list, setList] = useState<LinkedProviders>();
  const [methods, setMethods] = useState<NativeProviderMethod[]>([]);
  const [available, setAvailable] = useState<NativeProviderMethod[]>([]);
  const [notice, setNotice] = useState<Notice>();
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const prompt = useRef<AbortController | undefined>(undefined);

  const load = useCallback(async () => {
    const read = ++generation.current;
    setLoading(true);
    try {
      const result = await client.providers.list();
      if (mounted.current && read === generation.current) setList(result);
    } catch (error) {
      if (mounted.current && read === generation.current) setNotice(providerFailure(t, error));
    } finally {
      if (mounted.current && read === generation.current) setLoading(false);
    }
  }, [client, t]);

  useEffect(() => {
    mounted.current = true;
    pending.current = false;
    setWriting(false);
    const controller = new AbortController();
    void load();
    void (async () => {
      try {
        const discovered = await runtime.engine.methods();
        if (controller.signal.aborted) return;
        setMethods(discovered.providers);
        if (providerSignIn === undefined) {
          setAvailable([]);
          return;
        }
        const supported = await Promise.all(
          discovered.providers.map(async (method) => {
            if (method.mode === NATIVE_PROVIDER_SDK_MODE.SYSTEM) return undefined;
            try {
              return (await providerSignIn.available(method)) ? method : undefined;
            } catch {
              return undefined;
            }
          }),
        );
        if (!controller.signal.aborted)
          setAvailable(supported.filter((method) => method !== undefined));
      } catch {
        if (!controller.signal.aborted) {
          setMethods([]);
          setAvailable([]);
        }
      }
    })();
    return () => {
      mounted.current = false;
      generation.current += 1;
      controller.abort();
      prompt.current?.abort();
    };
  }, [load, providerSignIn, runtime]);

  const write = useCallback(
    async (action: (signal: AbortSignal) => Promise<boolean>) => {
      if (pending.current || !mounted.current) return;
      pending.current = true;
      generation.current += 1;
      setLoading(false);
      setWriting(true);
      setNotice(undefined);
      const controller = new AbortController();
      prompt.current = controller;
      try {
        const changed = await action(controller.signal);
        if (controller.signal.aborted) return;
        if (changed) {
          setNotice({ key: 'providers.updated' });
          await load();
        }
      } catch (error) {
        if (!controller.signal.aborted) setNotice(providerFailure(t, error));
      } finally {
        if (!controller.signal.aborted) {
          pending.current = false;
          setWriting(false);
        }
      }
    },
    [load, t],
  );

  const link = useCallback(
    (method: NativeProviderMethod) =>
      void write(async (signal) => {
        if (
          providerSignIn === undefined ||
          !available.some((item) => item.id === method.id) ||
          list?.providers.includes(method.id)
        )
          return false;
        const start = await client.providers.linkStart(method.id, { signal });
        if (signal.aborted) return false;
        const outcome = await providerSignIn.authenticate(
          { method, nonceDigest: start.nonceDigest, state: start.state },
          signal,
        );
        if (signal.aborted) return false;
        if (outcome.kind !== 'success') {
          const keys = {
            cancelled: 'providers.cancelled',
            unavailable: 'providers.unavailable',
            failed: 'providers.failed',
          } as const;
          setNotice({ key: keys[outcome.kind] });
          return false;
        }
        if (!('nonceDigest' in outcome.value) || outcome.value.nonceDigest !== start.nonceDigest) {
          setNotice({ key: 'providers.failed' });
          return false;
        }
        await client.providers.linkFinish(
          { linkId: start.linkId, credential: outcome.value },
          { signal },
        );
        return true;
      }),
    [available, client, list, providerSignIn, write],
  );

  const unlink = useCallback(
    (id: string) =>
      void write(async (signal) => {
        const name = methods.find((method) => method.id === id)?.displayName ?? id;
        const accepted = await confirm({
          title: t('providers.confirmTitle', { name }),
          message: t('providers.confirmMessage'),
          confirmLabel: t('providers.unlink'),
          cancelLabel: t('common.cancel'),
        });
        if (!accepted || signal.aborted) return false;
        await client.providers.unlink(id, { signal });
        return true;
      }),
    [client, confirm, methods, t, write],
  );

  const setPrimary = useCallback(
    (id: string) =>
      void write(async (signal) => {
        await client.providers.setPrimary(id, { signal });
        return true;
      }),
    [client, write],
  );

  const rows = useMemo(
    () =>
      (list?.providers ?? []).map((id) => ({
        id,
        name:
          methods.find((method) => method.id === id)?.displayName ??
          (id === PROVIDER_EMAIL_ID ? t('providers.email') : id),
        primary: list?.primaryProvider === id,
        canUnlink: list?.unlinkHints[id] === PROVIDER_UNLINK_HINT.ALLOWED,
        canSetPrimary:
          list?.primaryHints[id] === PROVIDER_PRIMARY_HINT.ALLOWED && list?.primaryProvider !== id,
      })),
    [list, methods, t],
  );

  return {
    rows,
    list,
    methods,
    notice,
    loading,
    writing,
    linkable:
      list === undefined || providerSignIn === undefined
        ? []
        : available.filter((method) => !list.providers.includes(method.id)),
    link,
    unlink,
    setPrimary,
    reload: useCallback(() => {
      if (!pending.current) void load();
    }, [load]),
  };
}
