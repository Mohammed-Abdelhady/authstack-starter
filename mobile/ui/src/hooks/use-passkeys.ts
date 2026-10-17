import type { PasskeyActions } from '@app/native-auth';
import { ApiError, type PasskeySummary } from '@app/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NOTICE_TONE } from '../components/Notice';
import {
  PASSKEY_LAST_WAY_IN_CODE,
  PASSKEY_REQUIRED_LAST_CODE,
  PASSKEYS_VIEW,
  type PasskeysView,
} from '../constants/passkeys';
import { useUi } from '../context/ui-context';
import { outcomeNotice, passkeyName, type PasskeyNotice } from '../logic/passkey-text';
import { toApiFailure } from '../logic/request-failure';
import { failureText } from '../logic/session-text';
import type { ApiFailure } from '../types';

interface ListState {
  /** Null until the first read answers. */
  passkeys: PasskeySummary[] | null;
  failure?: ApiFailure;
}

function viewOf({ passkeys, failure }: ListState): PasskeysView {
  if (passkeys === null) return failure ? PASSKEYS_VIEW.ERROR : PASSKEYS_VIEW.LOADING;
  return passkeys.length === 0 ? PASSKEYS_VIEW.EMPTY : PASSKEYS_VIEW.READY;
}

/** The list, and the add, rename and remove actions of the passkeys section. */
export function usePasskeys(actions: PasskeyActions) {
  const { t, confirm } = useUi();
  const [list, setList] = useState<ListState>({ passkeys: null });
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<PasskeyNotice>();
  const [adding, setAdding] = useState(false);
  const [busyRows, setBusyRows] = useState<ReadonlySet<string>>(new Set());
  // A read answers only while no write or newer read has started since it did.
  const generation = useRef(0);
  // Rows with a write in flight, checked before a second write can start.
  const pending = useRef(new Set<string>());

  const load = useCallback(async () => {
    generation.current += 1;
    const read = generation.current;
    setRefreshing(true);
    try {
      const { passkeys } = await actions.list();
      if (read === generation.current) setList({ passkeys });
    } catch (error) {
      if (read === generation.current) {
        setList((current) => ({ ...current, failure: toApiFailure(error) }));
      }
    } finally {
      if (read === generation.current) setRefreshing(false);
    }
  }, [actions]);

  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  /** Runs one write on a row, unless that row already has one in flight. */
  const writeRow = useCallback(
    async <T>(passkeyId: string, write: () => Promise<T>): Promise<T | undefined> => {
      if (pending.current.has(passkeyId)) return undefined;
      pending.current.add(passkeyId);
      // A list read that started before this write would answer with what it replaces.
      generation.current += 1;
      setRefreshing(false);
      setBusyRows(new Set(pending.current));
      try {
        return await write();
      } finally {
        pending.current.delete(passkeyId);
        setBusyRows(new Set(pending.current));
      }
    },
    [],
  );

  const add = useCallback(async () => {
    setNotice(undefined);
    setAdding(true);
    const outcome = await actions.register().finally(() => setAdding(false));
    setNotice(outcomeNotice(t, outcome));
    if (outcome.kind === 'created') await load();
  }, [actions, load, t]);

  const rename = useCallback(
    async (passkey: PasskeySummary, name: string): Promise<boolean> => {
      setNotice(undefined);
      try {
        const renamed = await writeRow(passkey.id, () => actions.rename(passkey.id, name.trim()));
        if (renamed === undefined) return false;
        setList((current) => ({
          passkeys: (current.passkeys ?? []).map((item) =>
            item.id === renamed.id
              ? {
                  ...renamed,
                  canRemove: item.canRemove,
                  removalBlockedCode: item.removalBlockedCode,
                }
              : item,
          ),
        }));
        return true;
      } catch {
        setNotice({
          tone: NOTICE_TONE.PROBLEM,
          title: t('passkeys.renameFailed.title', { name: passkeyName(t, passkey) }),
          description: t('passkeys.renameFailed.description'),
        });
        return false;
      }
    },
    [actions, t, writeRow],
  );

  const remove = useCallback(
    async (passkey: PasskeySummary) => {
      if (passkey.canRemove === false) return;
      if (pending.current.has(passkey.id)) return;
      setNotice(undefined);
      const name = passkeyName(t, passkey);
      const confirmed = await confirm({
        title: t('passkeys.confirmRemove.title', { name }),
        message: t('passkeys.confirmRemove.message'),
        confirmLabel: t('passkeys.remove'),
        cancelLabel: t('common.cancel'),
      });
      if (!confirmed) return;
      try {
        const removed = await writeRow(passkey.id, () => actions.remove(passkey.id));
        if (removed === undefined) return;
        setList((current) => ({
          passkeys: (current.passkeys ?? []).filter((item) => item.id !== passkey.id),
        }));
      } catch (error) {
        const lastWayIn = error instanceof ApiError && error.code === PASSKEY_LAST_WAY_IN_CODE;
        setNotice({
          tone: NOTICE_TONE.PROBLEM,
          title: t('passkeys.removeFailed.title', { name }),
          description:
            error instanceof ApiError && error.code === PASSKEY_REQUIRED_LAST_CODE
              ? t('passkeys.removeFailed.required')
              : lastWayIn
                ? t('passkeys.removeFailed.lastWayIn')
                : failureText(t, toApiFailure(error)),
        });
      }
    },
    [actions, confirm, t, writeRow],
  );

  return {
    view: viewOf(list),
    passkeys: list.passkeys ?? [],
    failure: failureText(t, list.failure),
    /** A refresh failed while the rows of an earlier read stay on screen. */
    refreshFailed: list.passkeys !== null && list.failure !== undefined,
    refreshing,
    notice,
    adding,
    busyRows,
    reload: useCallback(() => void load(), [load]),
    add: useCallback(() => void add(), [add]),
    rename,
    remove: useCallback((passkey: PasskeySummary) => void remove(passkey), [remove]),
  };
}
